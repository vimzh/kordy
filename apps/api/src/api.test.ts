import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import server from "./index";
import { db } from "./db";
import { users } from "./schema";

const userId = "api-contract-test";
process.env.TWELVE_DATA_API_KEY = "test-key";

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

test("queues a public weather task without a connection", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "public-weather-1", prompt: "Call me when rain is forecast in Bengaluru", selectedSources: ["Weather"] }),
  }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ status: "creating", task: { originalPrompt: "Call me when rain is forecast in Bengaluru", status: "creating" } });
});

test("queues an Indian stock task without a brokerage connection", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "india-stock-1", prompt: "Call me when RELIANCE on NSE closes above ₹1,500", selectedSources: ["Indian stocks (EOD)"] }),
  }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ status: "creating", task: { originalPrompt: "Call me when RELIANCE on NSE closes above ₹1,500", status: "creating" } });
});

test("rejects unauthenticated Pub/Sub delivery", async () => {
  const response = await server.fetch(new Request("http://localhost/webhooks/gmail", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  expect(response.status).toBe(401);
});

test("rejects unknown CALL-E webhook ids before making a provider API request", async () => {
  const response = await server.fetch(new Request("http://localhost/webhooks/calle", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CALL-E-Event-Id": "event-unknown" },
    body: JSON.stringify({ id: "event-unknown", data: { id: "call_unknown" } }),
  }));
  expect(response.status).toBe(404);
});
