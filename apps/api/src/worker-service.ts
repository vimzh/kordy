// Cloud Run entrypoint that keeps the durable worker alive behind a health endpoint.
import { startWorker } from "./worker";

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  fetch: () => Response.json({ ok: true, service: "kordy-worker" }),
});

startWorker().catch((error) => {
  console.error(error);
  process.exit(1);
});
