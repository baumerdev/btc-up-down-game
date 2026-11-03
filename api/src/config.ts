// Configuration from environment variables, read once at startup by server.ts and lambda.ts and
// passed to createApp (app.ts). Invalid values stop the start instead of running wrong (#18).

export interface Config {
  /** GUESS_WINDOW_MS, default 60 s. Only the end-to-end tests shorten it; Terraform never sets it. */
  guessWindowMs: number
  /** MAX_GUESS_DELAY_MS, default 5 s: maximum age of the seen display price when a guess arrives (#22). */
  maxGuessDelayMs: number
  /** TABLE_NAME: the players table. */
  tableName: string
  /** DYNAMODB_ENDPOINT: set only for DynamoDB Local; unset in AWS. */
  dynamoEndpoint: string | undefined
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tableName = env.TABLE_NAME
  if (!tableName) {
    throw new Error('TABLE_NAME is required')
  }

  const config: Config = {
    guessWindowMs: readPositiveInt(env, 'GUESS_WINDOW_MS', 60_000),
    maxGuessDelayMs: readPositiveInt(env, 'MAX_GUESS_DELAY_MS', 5_000),
    tableName,
    dynamoEndpoint: env.DYNAMODB_ENDPOINT || undefined,
  }

  console.log(JSON.stringify({ msg: 'config', ...config }))
  return config
}
