import { expect, test } from 'bun:test'
import { confirmedReplyInstruction, createCalleCall, normalizePhone } from './calle'

test('normalizes supported E.164 phone formatting', () => {
  expect(normalizePhone('+91 98765 43210')).toBe('+919876543210')
  expect(normalizePhone('98765 43210')).toBeNull()
})

test('requires an explicit CALL-E confirmation before sending a reply', () => {
  expect(confirmedReplyInstruction({ requested_action: 'send_reply', send_confirmed: 'yes', reply_instruction: 'Thanks for the update.' })).toBe('Thanks for the update.')
  expect(confirmedReplyInstruction({ requested_action: 'send_reply', send_confirmed: 'unknown', reply_instruction: 'Thanks.' })).toBeNull()
})

test('creates a server-side CALL-E task with an idempotency key', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.CALLE_API_KEY
  const originalWebhook = process.env.CALLE_WEBHOOK_URL
  let request: Request | undefined

  process.env.CALLE_API_KEY = 'test-key'
  process.env.CALLE_WEBHOOK_URL = 'https://kordy.example/webhooks/calle'
  globalThis.fetch = (async (input, init) => {
    request = new Request(input, init)
    return Response.json({ id: 'call_test', status: 'queued', task: 'Call me' }, { status: 201 })
  }) as typeof fetch

  try {
    await createCalleCall({ task: 'Call me', phone: '+919876543210', userId: 'user-1', eventId: 'gmail-1' })
    expect(request?.headers.get('Authorization')).toBe('Bearer test-key')
    expect(request?.headers.get('Idempotency-Key')).toBe('kordy:user-1:gmail-1')
    const body = await request?.json() as { task: string }
    expect(body).toMatchObject({
      recipients: [{ phones: ['+919876543210'] }],
      webhook_url: 'https://kordy.example/webhooks/calle',
    })
    expect(body.task).toContain("Speak like a thoughtful human")
    expect(body.task).toContain("Never read email addresses")
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.CALLE_API_KEY
    else process.env.CALLE_API_KEY = originalKey
    if (originalWebhook === undefined) delete process.env.CALLE_WEBHOOK_URL
    else process.env.CALLE_WEBHOOK_URL = originalWebhook
  }
})
