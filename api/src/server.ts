// Local Node server, started by `npm run dev` and the end-to-end tests (DECISIONS.md #19).
// Production runs the same app in Lambda (lambda.ts).
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { kraken } from './kraken.ts'
import { createDynamoClient, createStore, ensureLocalTable } from './store.ts'

const config = loadConfig()
// Never against real AWS: the shell's default AWS profile may belong to another account.
if (!config.dynamoEndpoint) {
  throw new Error(
    'DYNAMODB_ENDPOINT is required; the local server only runs against DynamoDB Local',
  )
}
const db = createDynamoClient(config.dynamoEndpoint)
await ensureLocalTable(db, config.tableName)

const port = Number(process.env.PORT ?? 3030)
serve({
  fetch: createApp({ prices: kraken, store: createStore(db, config.tableName), config }).fetch,
  port,
  // Local only: not reachable from the network.
  hostname: '127.0.0.1',
})

console.log(JSON.stringify({ msg: 'listening', port }))
