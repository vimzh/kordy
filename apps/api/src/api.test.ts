import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import server from "./index";
import { demoCredentialsMatch, validReturnTo } from "./auth";
import { createTask, db, saveCallTask, upsertUser } from "./db";
import { callTasks, users } from "./schema";

const userId = "api-contract-test";
process.env.TWELVE_DATA_API_KEY = "test-key";

function authCookie() {
  const payload = Buffer.from(JSON.stringify({ sub: userId, email: "api@example.com", name: "API Test", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  return `kyub_session=${payload}.${createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url")}`;
}

afterAll(async () => {
  await db.delete(callTasks).where(eq(callTasks.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

test("rejects a Gmail OAuth callback with mismatched state", async () => {
  const response = await server.fetch(new Request("http://localhost/connections/gmail/callback?state=wrong&code=test", { headers: { Cookie: `${authCookie()}; gmail_oauth_state=expected` } }));
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Invalid OAuth state");
});

test("accepts only short path-only OAuth return targets", () => {
  expect(validReturnTo("/home?resume=task-1")).toBe("/home?resume=task-1");
  expect(validReturnTo("https://evil.example/path")).toBeNull();
  expect(validReturnTo("//evil.example/path")).toBeNull();
  expect(validReturnTo("/\\evil.example/path")).toBeNull();
});

test("accepts only the published demo credentials", () => {
  expect(demoCredentialsMatch("demo@gmail.com", "demo1234")).toBe(true);
  expect(demoCredentialsMatch("DEMO@gmail.com", "demo1234")).toBe(true);
  expect(demoCredentialsMatch("demo@gmail.com", "wrong-password")).toBe(false);
});

test("rejects invalid demo login attempts", async () => {
  const response = await server.fetch(new Request("http://localhost/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@gmail.com", password: "wrong-password" }),
  }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Invalid email or password" });
});

test("requires Gmail before parsing a task and keeps the public response shape", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "request-1", prompt: "Call me when alice@example.com emails about invoices", selectedSources: ["Gmail"], executionMode: "approval" }),
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ status: "connection_required", connection: "gmail" });
});

test("queues a public weather task without a connection", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "public-weather-1", prompt: "Call me when rain is forecast in Bengaluru", selectedSources: ["Weather"], executionMode: "approval" }),
  }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ status: "creating", task: { originalPrompt: "Call me when rain is forecast in Bengaluru", status: "creating" } });
});

test("queues an Indian stock task without a brokerage connection", async () => {
  const response = await server.fetch(new Request("http://localhost/tasks", {
    method: "POST",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "india-stock-1", prompt: "Call me when RELIANCE on NSE closes above ₹1,500", selectedSources: ["Indian stocks (EOD)"], executionMode: "approval" }),
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

test("validates and persists CALL-E calling preferences", async () => {
  const response = await server.fetch(new Request("http://localhost/profile", {
    method: "PATCH",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ defaultPhone: "+919876543210", callRegion: "in", callLocale: "hi-in", approvalExpiryMinutes: 90 }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ profile: { defaultPhone: "+919876543210", callRegion: "IN", callLocale: "hi-IN", approvalExpiryMinutes: 90 } });

  const invalid = await server.fetch(new Request("http://localhost/profile", {
    method: "PATCH",
    headers: { Cookie: authCookie(), "Content-Type": "application/json" },
    body: JSON.stringify({ callRegion: "ZZ" }),
  }));
  expect(invalid.status).toBe(400);
});

test("previews, edits, filters, duplicates, and permanently deletes a draft task", async () => {
  await upsertUser({ sub: userId, email: "api@example.com", name: "API Test" });
  await createTask({
    id: "api-managed-task", userId, requestId: "api-managed-request", name: "Managed alert", prompt: "Call me when USD/INR rises above 90", status: "draft", parserModel: "test",
    trigger: { type: "fx.rate.threshold", base: "USD", quote: "INR", operator: "above", threshold: 90 },
    action: { type: "calle.call", targetType: "self", targetName: "API Test", phone: "+919876543210", task: "Explain the currency alert", executionMode: "approval" },
    executionMode: "approval",
  });
  const request = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://localhost${path}`, { ...init, headers: { Cookie: authCookie(), "Content-Type": "application/json", ...init.headers } }));
  const edited = await request("/tasks/api-managed-task", { method: "PATCH", body: JSON.stringify({ name: "Managed FX alert", delivery: { timezone: "Asia/Kolkata", quietHoursStart: "22:00", quietHoursEnd: "07:00", maxCallsPerHour: 0, region: "in", locale: "hi-in" } }) });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ task: { name: "Managed FX alert", status: "draft", executionMode: "approval", delivery: { timezone: "Asia/Kolkata", maxCallsPerHour: 0, region: "IN", locale: "hi-IN" } } });
  const preview = await request("/tasks/api-managed-task/test", { method: "POST" });
  expect(await preview.json()).toMatchObject({ test: true, dispatched: false, preview: { source: "fx.rate.threshold", executionMode: "approval", callObjective: "Explain the currency alert" } });
  const listed = await request("/tasks?status=draft&search=Managed%20FX");
  expect((await listed.json()).tasks).toHaveLength(1);
  const duplicated = await request("/tasks/api-managed-task/duplicate", { method: "POST" });
  expect(await duplicated.json()).toMatchObject({ task: { name: "Managed FX alert copy", status: "draft" } });
  expect((await request("/tasks/api-managed-task", { method: "DELETE" })).status).toBe(400);
  expect((await request("/tasks/api-managed-task?confirm=true", { method: "DELETE" })).status).toBe(204);
});

test("persists terminal CALL-E evidence without placing a call", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CALLE_API_KEY;
  process.env.CALLE_API_KEY = "test-key";
  await upsertUser({ sub: userId, email: "api@example.com", name: "API Test" });
  await saveCallTask({ id: "call_observability", userId, task: "Weather alert", phone: "+919876543210", source: "weather", status: "queued" });
  globalThis.fetch = (async (_input, _init) => Response.json({
    id: "call_observability",
    status: "completed",
    task: "Weather alert",
    summary: "The recipient acknowledged the alert.",
    structured_result: { requested_action: "acknowledge", weather_alert_response: "acknowledged", action_details: "", evidence: "The recipient said okay." },
    task_completed: true,
    completion_confidence: { score: 0.94, label: "high" },
    evidence: ["The recipient said okay."],
    recipients: [{
      id: "rcp_1",
      phones: ["+919876543210"],
      locale: "hi-IN",
      region: "IN",
      status: "completed",
      structured_result: { answered_by: "human", evidence: "The intended recipient spoke." },
      summary: "The recipient acknowledged the alert.",
      attempts: [{
        id: "att_1",
        phone: "+919876543210",
        status: "completed",
        started_at: "2026-08-27T10:00:00Z",
        completed_at: "2026-08-27T10:00:20Z",
        summary: "Alert acknowledged.",
        transcript_turns: [{ offset_seconds: 0, speaker: "bot", text: "Hi, it's Kordy." }, { offset_seconds: 4, speaker: "user", text: "Okay, thanks." }],
        provider_call_id: "provider_1",
        failure_code: null,
        failure_message: null,
      }],
    }],
    failure_code: null,
    failure_message: null,
    completed_at: "2026-08-27T10:00:20Z",
  })) as typeof fetch;

  try {
    const response = await server.fetch(new Request("http://localhost/webhooks/calle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CALL-E-Event-Id": "evt_observability" },
      body: JSON.stringify({ id: "evt_observability", data: { id: "call_observability" } }),
    }));
    expect(response.status).toBe(200);
    const [stored] = await db.select().from(callTasks).where(eq(callTasks.id, "call_observability"));
    expect(stored).toMatchObject({
      status: "completed",
      taskCompleted: true,
      completionConfidence: { score: 0.94, label: "high" },
      evidence: ["The recipient said okay."],
      answeredBy: "human",
      region: "IN",
      locale: "hi-IN",
      providerEventId: "evt_observability",
    });
    expect((stored?.recipients as Array<{ attempts: Array<{ transcript_turns: unknown[] }> }>)[0]?.attempts[0]?.transcript_turns).toHaveLength(2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CALLE_API_KEY; else process.env.CALLE_API_KEY = originalKey;
  }
});
