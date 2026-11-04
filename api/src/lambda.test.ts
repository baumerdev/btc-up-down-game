// The Lambda entry's own checks, on API Gateway events (#14, #25). Rejected requests never reach
// the app, so no database or Kraken is needed.
import { beforeAll, expect, it } from 'vitest'

const SECRET = 'test-origin-secret'
let handler: (event: unknown) => Promise<{ statusCode: number; body: string }>

beforeAll(async () => {
  process.env.ORIGIN_SECRET = SECRET
  process.env.TABLE_NAME = 'unused'
  ;({ handler } = (await import('./lambda.ts')) as unknown as { handler: typeof handler })
})

/** A minimal API Gateway HTTP API (payload 2.0) event. */
const event = (rawPath: string, secret = SECRET) => ({
  version: '2.0',
  routeKey: '$default',
  rawPath,
  rawQueryString: '',
  headers: { host: 'example.com', 'x-origin-secret': secret },
  requestContext: {
    domainName: 'example.com',
    http: { method: 'GET', path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
  },
  isBase64Encoded: false,
})

it('rejects requests without the origin secret', async () => {
  expect((await handler(event('/api/price', 'wrong'))).statusCode).toBe(403)
})

it.each(['/api/./me', '/api/%2e/me', '/api/x/../me', '/api/price/%2e%2e/me', '/api/%6De'])(
  'rejects the raw path %s before it is normalised',
  async (rawPath) => {
    const res = await handler(event(rawPath))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'INVALID_REQUEST' } })
  },
)
