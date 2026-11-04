// DynamoDB access for app.ts: one item per player (DECISIONS.md #10). The concurrency rules live
// in the condition expressions (#7): of several parallel writes for the same guess, exactly one wins.
import {
  ConditionalCheckFailedException,
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { Trade } from './rules.ts'
import type { Direction, Outcome } from './types.ts'

// Stored items. All times are epoch milliseconds; app.ts turns them into ISO strings for the API.

export interface GuessItem {
  id: string
  direction: Direction
  createdAt: number
  /** `createdAt` plus the guess window, fixed when the guess arrives (#4). */
  resolvableAt: number
  /** Set by `setEntryPrice` once Kraken's data for `createdAt` is complete. */
  entryPrice?: number
  entryTradeTime?: number
  /** Set by `markWaiting` when the price at the window end equals the entry price. */
  waiting?: boolean
}

export interface HistoryItem {
  direction: Direction
  createdAt: number
  entryPrice: number
  decidingPrice: number
  decidingTradeTime: number
  outcome: Outcome
}

export interface PlayerItem {
  playerId: string
  score: number
  updatedAt: number
  /** DynamoDB TTL in epoch seconds: one year after the last write (#10). */
  expiresAt: number
  activeGuess?: GuessItem
  /** Newest first, at most 10. */
  history: HistoryItem[]
}

const HISTORY_LENGTH = 10
const RETENTION_S = 365 * 24 * 60 * 60

/** The DynamoDB client: DynamoDB Local when `endpoint` is set, otherwise AWS with Lambda's role. */
export function createDynamoClient(endpoint: string | undefined): DynamoDBDocumentClient {
  const client = endpoint
    ? // Fixed dummy credentials, so no AWS profile on the developer's machine is ever read.
      new DynamoDBClient({
        endpoint,
        region: 'eu-central-1',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      })
    : new DynamoDBClient({})
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } })
}

/** Creates the table in DynamoDB Local (server.ts, tests). In AWS, Terraform owns the table. */
export async function ensureLocalTable(db: DynamoDBDocumentClient, table: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.send(
        new CreateTableCommand({
          TableName: table,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [{ AttributeName: 'playerId', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: 'playerId', KeyType: 'HASH' }],
        }),
      )
      return
    } catch (error) {
      if (error instanceof ResourceInUseException) {
        return
      }
      // DynamoDB Local may still be starting right after `docker compose up`.
      if (attempt >= 20) {
        throw error
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

const isConditionFailed = (error: unknown) => error instanceof ConditionalCheckFailedException

/**
 * Runs a conditional write. A failed condition means another request changed the guess first
 * (#7); that is not an error, and app.ts simply re-reads the player.
 */
async function writeIfConditionHolds(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch (error) {
    if (!isConditionFailed(error)) {
      throw error
    }
  }
}

export function createStore(db: DynamoDBDocumentClient, table: string) {
  /** `updatedAt` and the TTL, set by every write so the year starts again (#10). */
  const lastWrite = (now: number) => ({
    ':now': now,
    ':expires': Math.floor(now / 1000) + RETENTION_S,
  })

  return {
    async getPlayer(playerId: string): Promise<PlayerItem | undefined> {
      const res = await db.send(
        new GetCommand({ TableName: table, Key: { playerId }, ConsistentRead: true }),
      )
      return res.Item as PlayerItem | undefined
    },

    /** POST /api/me/guess without a player header: player and first guess in one write (#9). */
    async createPlayerWithGuess(playerId: string, guess: GuessItem, now: number): Promise<void> {
      const item: PlayerItem = {
        playerId,
        score: 0,
        updatedAt: now,
        expiresAt: lastWrite(now)[':expires'],
        activeGuess: guess,
        history: [],
      }
      await db.send(
        new PutCommand({
          TableName: table,
          Item: item,
          ConditionExpression: 'attribute_not_exists(playerId)',
        }),
      )
    },

    /**
     * POST /api/me/guess for an existing player: stores the guess only if no guess is active.
     * Returns why it failed, so app.ts can answer 404 (unknown player) or 409 (guess active).
     */
    async placeGuess(
      playerId: string,
      guess: GuessItem,
      now: number,
    ): Promise<'ok' | 'not-found' | 'active'> {
      try {
        await db.send(
          new UpdateCommand({
            TableName: table,
            Key: { playerId },
            UpdateExpression: 'SET activeGuess = :guess, updatedAt = :now, expiresAt = :expires',
            ConditionExpression: 'attribute_exists(playerId) AND attribute_not_exists(activeGuess)',
            ExpressionAttributeValues: { ':guess': guess, ...lastWrite(now) },
            ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
          }),
        )
        return 'ok'
      } catch (error) {
        if (!isConditionFailed(error)) {
          throw error
        }
        return error.Item ? 'active' : 'not-found'
      }
    },

    /** Stores the entry price on the active guess, once, and only if it is still the same guess. */
    setEntryPrice(playerId: string, guessId: string, trade: Trade, now: number): Promise<void> {
      return writeIfConditionHolds(
        db.send(
          new UpdateCommand({
            TableName: table,
            Key: { playerId },
            UpdateExpression:
              'SET activeGuess.entryPrice = :price, activeGuess.entryTradeTime = :time, updatedAt = :now, expiresAt = :expires',
            ConditionExpression:
              'activeGuess.id = :id AND attribute_not_exists(activeGuess.entryPrice)',
            ExpressionAttributeValues: {
              ':id': guessId,
              ':price': trade.price,
              ':time': trade.time,
              ...lastWrite(now),
            },
          }),
        ),
      )
    },

    /** Marks the active guess as waiting, so GET /api/me reports that state too (#25). */
    markWaiting(playerId: string, guessId: string, now: number): Promise<void> {
      return writeIfConditionHolds(
        db.send(
          new UpdateCommand({
            TableName: table,
            Key: { playerId },
            UpdateExpression:
              'SET activeGuess.waiting = :true, updatedAt = :now, expiresAt = :expires',
            ConditionExpression: 'activeGuess.id = :id',
            ExpressionAttributeValues: { ':id': guessId, ':true': true, ...lastWrite(now) },
          }),
        ),
      )
    },

    /**
     * Scores a resolved guess in one atomic write: remove the active guess, add ±1 to the score,
     * put the result first in the history. The new history is computed from `player` as read
     * before. That is safe: the condition fails if another request scored this guess in between,
     * and scoring is the only write that changes the history.
     */
    scoreGuess(
      player: PlayerItem,
      guessId: string,
      result: HistoryItem,
      now: number,
    ): Promise<void> {
      const history = [result, ...player.history].slice(0, HISTORY_LENGTH)

      return writeIfConditionHolds(
        db.send(
          new UpdateCommand({
            TableName: table,
            Key: { playerId: player.playerId },
            UpdateExpression:
              'SET score = score + :delta, history = :history, updatedAt = :now, expiresAt = :expires REMOVE activeGuess',
            ConditionExpression: 'activeGuess.id = :id',
            ExpressionAttributeValues: {
              ':id': guessId,
              ':delta': result.outcome === 'won' ? 1 : -1,
              ':history': history,
              ...lastWrite(now),
            },
          }),
        ),
      )
    },
  }
}

export type Store = ReturnType<typeof createStore>
