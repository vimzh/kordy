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

Register `http://localhost:3007/auth/google/callback` as an authorized redirect URI in the Google OAuth client.

Run all checks with:

```sh
bun run lint
bun run typecheck
bun run build
```
