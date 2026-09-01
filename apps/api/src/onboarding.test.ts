// Verifies the onboarding safety gates without placing a real phone call.
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import server from "./index";
import { db, getProfile, listContacts, saveCallTask, saveIntegrationConnection, upsertUser } from "./db";
import { callTasks, users } from "./schema";

const userId = `onboarding-${randomUUID()}`;
const originalPhone = "+919876543210";
const changedPhone = "+919876543211";

function authCookie() {
  const payload = Buffer.from(JSON.stringify({ sub: userId, email: `${userId}@example.com`, name: "Onboarding Test", exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  return `kyub_session=${payload}.${createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url")}`;
}

function request(path: string, init: RequestInit = {}) {
  return server.fetch(new Request(`http://localhost${path}`, { ...init, headers: { Cookie: authCookie(), "Content-Type": "application/json", ...init.headers } }));
}

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("completes consent, mocked verification, webhook ownership, and automatic-call guards end to end", async () => {
  await upsertUser({ sub: userId, email: `${userId}@example.com`, name: "Onboarding Test" });
  expect(await listContacts(userId)).toEqual([]);

  expect((await request("/profile", { method: "PATCH", body: JSON.stringify({ defaultPhone: originalPhone, callRegion: "IN", callLocale: "en-IN" }) })).status).toBe(200);
  const blockedWithoutConsent = await request("/calls", { method: "POST", body: JSON.stringify({ task: "A test alert", phone: originalPhone, eventId: "blocked-no-consent", source: "generic" }) });
  expect(blockedWithoutConsent.status).toBe(409);
  expect(await blockedWithoutConsent.json()).toMatchObject({ code: "outbound_call_consent_required" });
  const consent = await request("/onboarding/consent", { method: "POST", body: JSON.stringify({ consent: true }) });
  expect(consent.status).toBe(200);
  expect(await consent.json()).toMatchObject({
    profile: { defaultPhone: originalPhone, outboundCallConsentAt: expect.any(String), phoneVerifiedAt: null, readyForAutomaticCalls: false },
    steps: { phone: true, consent: true, verified: false, connection: false, trigger: false },
    usage: { callsUsed: 0, callsLimit: expect.any(Number), tasksCreatedLastHour: 0, taskHourlyLimit: 20, activeTasks: 0, taskActiveLimit: 100 },
    reconnectNeeded: [],
    latestVerificationCall: null,
  });

  const blockedTask = await request("/tasks", { method: "POST", body: JSON.stringify({ requestId: "automatic-before-verification", prompt: "Call me when rain is forecast in Bengaluru", selectedSources: ["Weather"] }) });
  expect(blockedTask.status).toBe(409);
  expect(await blockedTask.json()).toEqual({ status: "onboarding_required", missing: ["verified"] });

  const approvalTask = await request("/tasks", { method: "POST", body: JSON.stringify({ requestId: "approval-before-verification", prompt: "Call me when rain is forecast in Bengaluru", selectedSources: ["Weather"], executionMode: "approval" }) });
  expect(approvalTask.status).toBe(202);

  await saveIntegrationConnection({ id: `${userId}-github`, userId, provider: "github", label: "GitHub needs reconnect", encryptedCredential: "test", metadata: {}, status: "needs_reconnect" });
  const blockedCall = await request("/calls", { method: "POST", body: JSON.stringify({ task: "A test alert", phone: originalPhone, eventId: "blocked-unverified", source: "generic" }) });
  expect(blockedCall.status).toBe(409);
  expect(await blockedCall.json()).toMatchObject({ code: "phone_verification_required" });

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CALLE_API_KEY;
  const originalBase = process.env.CALLE_BASE_URL;
  const originalWebhook = process.env.CALLE_WEBHOOK_URL;
  process.env.CALLE_API_KEY = "test-key";
  process.env.CALLE_BASE_URL = "https://calle.invalid";
  process.env.CALLE_WEBHOOK_URL = "https://api.example/webhooks/calle";
  let createdCallId = "";
  let creationBody: Record<string, unknown> | null = null;
  let callCreationCount = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "https://calle.invalid/v1/calls" && init?.method === "POST") {
      callCreationCount += 1;
      createdCallId = `call_verify_${randomUUID().replaceAll("-", "")}`;
      creationBody = JSON.parse(String(init.body));
      return Response.json({ id: createdCallId, status: "queued", task: "Phone verification" }, { status: 201 });
    }
    if (url === `https://calle.invalid/v1/calls/${createdCallId}`) return Response.json(verifiedCall(createdCallId, originalPhone));
    if (url === "https://calle.invalid/v1/calls/call_stale_phone") return Response.json(verifiedCall("call_stale_phone", originalPhone));
    throw new Error(`Unexpected outbound request: ${url}`);
  }) as typeof fetch;

  try {
    expect((await request("/onboarding/test-call", { method: "POST", body: JSON.stringify({ acknowledgeCost: false }) })).status).toBe(400);
    const testCall = await request("/onboarding/test-call", { method: "POST", body: JSON.stringify({ acknowledgeCost: true }) });
    expect(testCall.status).toBe(201);
    expect(await testCall.json()).toMatchObject({ call: { id: createdCallId, status: "queued" } });
    expect(creationBody).toMatchObject({ recipients: [{ phones: [originalPhone] }], metadata: { kordy_source: "verification" } });
    const repeatedTestCall = await request("/onboarding/test-call", { method: "POST", body: JSON.stringify({ acknowledgeCost: true }) });
    expect(repeatedTestCall.status).toBe(200);
    expect(await repeatedTestCall.json()).toMatchObject({ call: { id: createdCallId, status: "queued" }, reused: true });
    expect(callCreationCount).toBe(1);

    const beforeWebhook = await request("/onboarding");
    expect(await beforeWebhook.json()).toMatchObject({
      steps: { phone: true, consent: true, verified: false, connection: false, trigger: true },
      usage: { callsUsed: 1 },
      reconnectNeeded: [{ id: `${userId}-github`, provider: "github", label: "GitHub needs reconnect" }],
      latestVerificationCall: { id: createdCallId, status: "queued", failureMessage: null, createdAt: expect.any(String) },
    });

    const webhook = await server.fetch(new Request("http://localhost/webhooks/calle", { method: "POST", headers: { "Content-Type": "application/json", "CALL-E-Event-Id": "evt_verified" }, body: JSON.stringify({ id: "evt_verified", data: { id: createdCallId } }) }));
    expect(webhook.status).toBe(200);
    expect(await getProfile(userId)).toMatchObject({ defaultPhone: originalPhone, phoneVerifiedAt: expect.any(String) });
    expect((await request("/onboarding/test-call", { method: "POST", body: JSON.stringify({ acknowledgeCost: true }) })).status).toBe(409);

    await db.update(users).set({ phoneVerifiedAt: null }).where(eq(users.id, userId));
    const replayedWebhook = await server.fetch(new Request("http://localhost/webhooks/calle", { method: "POST", headers: { "Content-Type": "application/json", "CALL-E-Event-Id": "evt_verified_replay" }, body: JSON.stringify({ id: "evt_verified_replay", data: { id: createdCallId } }) }));
    expect(replayedWebhook.status).toBe(200);
    expect(await getProfile(userId)).toMatchObject({ defaultPhone: originalPhone, phoneVerifiedAt: expect.any(String) });

    await request("/profile", { method: "PATCH", body: JSON.stringify({ defaultPhone: changedPhone }) });
    expect((await getProfile(userId))?.phoneVerifiedAt).toBeNull();
    await saveCallTask({ id: "call_stale_phone", userId, task: "Verify phone", phone: originalPhone, source: "verification", status: "queued" });
    const staleWebhook = await server.fetch(new Request("http://localhost/webhooks/calle", { method: "POST", headers: { "Content-Type": "application/json", "CALL-E-Event-Id": "evt_stale" }, body: JSON.stringify({ id: "evt_stale", data: { id: "call_stale_phone" } }) }));
    expect(staleWebhook.status).toBe(200);
    expect(await getProfile(userId)).toMatchObject({ defaultPhone: changedPhone, phoneVerifiedAt: null });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CALLE_API_KEY; else process.env.CALLE_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.CALLE_BASE_URL; else process.env.CALLE_BASE_URL = originalBase;
    if (originalWebhook === undefined) delete process.env.CALLE_WEBHOOK_URL; else process.env.CALLE_WEBHOOK_URL = originalWebhook;
    await db.delete(callTasks).where(eq(callTasks.userId, userId));
  }
});

function verifiedCall(id: string, phone: string) {
  return {
    id,
    status: "completed",
    task: "Verify phone ownership",
    structured_result: { requested_action: "confirm_ownership", ownership_confirmed: "yes", action_details: "", evidence: "The recipient explicitly confirmed ownership." },
    task_completed: true,
    completion_confidence: { score: 0.95, label: "high" },
    evidence: ["The recipient explicitly confirmed ownership."],
    recipients: [{ id: "recipient", phones: [phone], locale: "en-IN", region: "IN", status: "completed", structured_result: { answered_by: "human", evidence: "The intended recipient answered." }, summary: "Ownership confirmed.", attempts: [] }],
    completed_at: new Date().toISOString(),
  };
}
