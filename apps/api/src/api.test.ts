import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import server from "./index";
import { db } from "./db";
import { users } from "./schema";

const userId = "api-contract-test";

function authCookie() {
  const payload = Buffer.from(JSON.stringify({ sub: userId, email: "api@example.com", name: "API Test", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  return `kyub_session=${payload}.${createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url")}`;
}

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("rejects a Gmail OAuth callback with mismatched state", async () => {
  const response = await server.fetch(new Request("http://localhost/connections/gmail/callback?state=wrong&code=test", { headers: { Cookie: `${authCookie()}; gmail_oauth_state=expected` } }));
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Invalid OAuth state");
});

test("requires Gmail before parsing a task and keeps the public response shape", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "request-1", prompt: "Call me when alice@example.com emails about invoices", selectedSources: ["Gmail"] }),
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ status: "connection_required", connection: "gmail" });
});

test("rejects unauthenticated Pub/Sub delivery", async () => {
  const response = await server.fetch(new Request("http://localhost/webhooks/gmail", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  expect(response.status).toBe(401);
});
