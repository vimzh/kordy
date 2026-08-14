import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { clearSession, currentSession, finishGoogleAuth, startGoogleAuth } from './auth'
import { createContact, initializeDatabase, listContacts } from './db'

const app = new Hono()
const webOrigin = new URL(process.env.WEB_URL ?? 'http://localhost:3006').origin

const databaseReady = initializeDatabase()

app.use('/contacts', cors({ origin: webOrigin, credentials: true }))
app.use('/auth/logout', cors({ origin: webOrigin, credentials: true }))

app.get('/', (c) => {
  return c.text('Kordy API')
})

app.get('/health', (c) => c.json({ status: 'ok' }))
app.get('/auth/google', startGoogleAuth)
app.get('/auth/google/callback', finishGoogleAuth)
app.get('/auth/me', (c) => c.json({ user: currentSession(c) }))
app.post('/auth/logout', clearSession)

app.get('/contacts', async (c) => {
  if (!currentSession(c)) return c.json({ error: 'Unauthorized' }, 401)
  return c.json({ contacts: await listContacts() })
})

app.post('/contacts', async (c) => {
  if (!currentSession(c)) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  if (!name || !summary || !phone) return c.json({ error: 'Name, summary, and phone are required' }, 400)
  if (name.length > 100 || summary.length > 200 || phone.length > 30) return c.json({ error: 'Contact details are too long' }, 400)

  try {
    return c.json({ contact: await createContact({ name, summary, phone }) }, 201)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return c.json({ error: 'That phone number already exists' }, 409)
    throw error
  }
})

export default {
  port: Number(process.env.PORT ?? 3007),
  async fetch(request: Request) {
    await databaseReady
    return app.fetch(request)
  },
}
