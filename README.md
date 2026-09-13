# Kyub

Minimal Bun monorepo with a Next.js + shadcn/ui frontend and Hono API.

## Development

```sh
bun install
bun run db:up
bun run dev
```

- Web: http://localhost:3006
- API: http://localhost:3007
- Health: http://localhost:3007/health
- PostgreSQL: localhost:5435

Register `http://localhost:3007/connections/gmail/callback` and `http://localhost:3007/connections/google-calendar/callback` as authorized redirect URIs in the Google OAuth client.

GitHub and n8n connections generate a webhook URL and one-time secret in the Connections page. Stripe uses the same flow but requires the endpoint `whsec_` secret that Stripe generates.

Cost guards default to 20 outbound calls per user in a rolling 24-hour window (`CALLE_DAILY_CALL_LIMIT`), 20 new tasks per hour, and 100 non-archived tasks. Vercel and Google Calendar poll every 5 minutes, Notion every 15 minutes, public sources every 15 minutes, and Indian stock quotes once per trading day after market close. Connected providers are not polled without an active task, and identical public-data reads are coalesced for one minute.

Indian stock triggers use Twelve Data's end-of-day NSE/BSE quotes. Set `TWELVE_DATA_API_KEY` to a server-side key whose plan permits distribution to the app's end users.

Run all checks with:

```sh
bun run lint
bun run typecheck
bun run build
```
