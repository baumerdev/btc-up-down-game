// Local Node server, started by `npm run dev` and the end-to-end tests (DECISIONS.md #19).
// Production runs the same app in Lambda (lambda.ts).
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { kraken } from './kraken.ts'
import { createDynamoClient, createStore, ensureLocalTable } from './store.ts'

const config = loadConfig()
const db = createDynamoClient(config.dynamoEndpoint)
if (config.dynamoEndpoint) {
  await ensureLocalTable(db, config.tableName)
}

const port = Number(process.env.PORT ?? 3030)
serve({
  fetch: createApp({ prices: kraken, store: createStore(db, config.tableName), config }).fetch,
  port,
})

console.log(JSON.stringify({ msg: 'listening', port }))
