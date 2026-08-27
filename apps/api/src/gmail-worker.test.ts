import { expect, test } from "bun:test";
import { GmailApiError } from "./gmail";
import { CalleApiError } from "./calle";
import {
  callRetryAt,
  passesGmailRuleFilter,
  retryDelayMs,
  retryDisposition,
  runWorkerOnce,
  WorkerDependencyError,
  type WorkerConnection,
  type WorkerDependencies,
} from "./gmail-worker";

test("rejects explicit Gmail rule mismatches before spending a model call", () => {
  const task = { id: "task-1", userId: "user-1", originalPrompt: "Call me", instruction: "Call me", phone: "+12025550123", senders: ["alice@example.com"], subjectKeywords: ["invoice"], bodyKeywords: ["overdue"], labels: ["IMPORTANT"] };
  const matching = { id: "message-1", sender: "Alice <alice@example.com>", subject: "Invoice notice", snippet: "Now overdue", body: "", labelIds: ["IMPORTANT"] };
  expect(passesGmailRuleFilter(task, matching)).toBe(true);
  expect(passesGmailRuleFilter(task, { ...matching, sender: "bob@example.com" })).toBe(false);
  expect(passesGmailRuleFilter(task, { ...matching, labelIds: [] })).toBe(false);
});

const connection: WorkerConnection = {
  id: "connection-1",
  userId: "user-1",
  emailAddress: "me@example.com",
  historyId: "10",
  topicName: "projects/test/topics/gmail",
  lastSyncedAt: "2026-08-14T00:00:00Z",
};

function dependencies(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return {
    claimEvent: async () => ({ id: "event-1", connectionId: connection.id, attempts: 0 }),
    loadConnection: async () => connection,
    getAccessToken: async () => "access-token",
    listActiveTasks: async () => [],
    persistMessage: async () => {},
    loadRunDecision: async () => null,
    canDispatchCall: async () => true,
    matchTask: async () => ({ matches: true, confidence: "high", reason: "The email matches the saved trigger." }),
    claimRun: async () => null,
    dispatchCall: async () => ({ id: "call-1" }),
    markRunComplete: async () => {},
    markRunFailed: async () => {},
    advanceCursor: async () => {},
    recoverMessages: async () => [],
    resetWatch: async () => {},
    markEventComplete: async () => {},
    markEventFailed: async () => {},
    ...overrides,
  };
}

test("classifies retryable Gmail and network failures", () => {
  expect(retryDisposition(new GmailApiError(404, "stale history"))).toBe("reset-history");
  expect(retryDisposition(new GmailApiError(429, "quota"))).toBe("retry");
  expect(retryDisposition(new GmailApiError(403, JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } })))).toBe("retry");
  expect(retryDisposition(new GmailApiError(503, "unavailable"))).toBe("retry");
  expect(retryDisposition(new GmailApiError(401, "expired"))).toBe("fatal");
  expect(retryDisposition(new TypeError("network error"))).toBe("retry");
  expect(retryDisposition(new WorkerDependencyError("model rate limit", true))).toBe("retry");
  expect(retryDisposition(new WorkerDependencyError("invalid model request", false))).toBe("fatal");
  expect(retryDisposition(new Error("bad data"))).toBe("fatal");
});

test("retries transient calls through attempt seven and stops after attempt eight", () => {
  const error = new TypeError("network error");
  expect(callRetryAt(error, 6, 0, () => 0)).toEqual(new Date(60_000));
  expect(callRetryAt(error, 7, 0, () => 0)).toBeNull();
});

test("honors CALL-E Retry-After without changing the idempotent operation", () => {
  const error = new CalleApiError({ status: 429, code: "rate_limit_exceeded", message: "Try later.", details: {}, retryAfterSeconds: 12 });
  expect(callRetryAt(error, 0, 1_000, () => 0)).toEqual(new Date(13_000));
});

test("uses capped exponential backoff with bounded jitter", () => {
  expect(retryDelayMs(0, () => 0)).toBe(1_000);
  expect(retryDelayMs(3, () => 0.5)).toBe(8_500);
  expect(retryDelayMs(20, () => 0.999)).toBe(60_999);
});

test("keeps the event pending when CALL-E needs a durable retry", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let runRetryAt: Date | null = null;
  let eventRetryAt: Date | null = null;
  let advanced = false;
  let taskConnectionId: string | undefined;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/history?")) return Response.json({
      history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
      historyId: "11",
    });
    return Response.json({
      id: "message-1",
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "From", value: "alice@example.com" }, { name: "Subject", value: "Alert" }] },
    });
  }) as typeof fetch;

  try {
    await runWorkerOnce(dependencies({
      listActiveTasks: async (connectionId) => {
        taskConnectionId = connectionId;
        return [{ id: "task-1", userId: "user-1", originalPrompt: "Call me when Alice emails", instruction: "Call me", phone: "+12025550123", senders: ["alice@example.com"] }];
      },
      claimRun: async () => ({ id: "run-1", attempts: 0 }),
      dispatchCall: async () => { throw new TypeError("network error"); },
      markRunFailed: async (_id, _error, retryAt) => { runRetryAt = retryAt; },
      advanceCursor: async () => { advanced = true; },
      markEventFailed: async (_id, _error, retryAt) => { eventRetryAt = retryAt; },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requests.find((url) => url.includes("/messages/"))).toContain("format=full");
  expect(runRetryAt).toBeInstanceOf(Date);
  expect(eventRetryAt).toBeInstanceOf(Date);
  expect(advanced).toBe(false);
  expect(taskConnectionId).toBe(connection.id);
});

test("recovers a stale history gap before resetting the watch", async () => {
  const originalFetch = globalThis.fetch;
  const order: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/history?")) return new Response("stale history", { status: 404 });
    if (url.endsWith("/watch")) return Response.json({ historyId: "20", expiration: "2000000000000" });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    await runWorkerOnce(dependencies({
      recoverMessages: async (loaded, _token, format) => {
        expect(loaded.lastSyncedAt).toBe("2026-08-14T00:00:00Z");
        expect(format).toBe("metadata");
        order.push("recover");
        return [{ id: "recovered-1", sender: "", subject: "", body: "", labelIds: ["INBOX"] }];
      },
      persistMessage: async () => { order.push("persist"); },
      resetWatch: async () => { order.push("reset"); },
      markEventComplete: async () => { order.push("complete"); },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(order).toEqual(["recover", "persist", "reset", "complete"]);
});

test("continues the history batch after a terminal CALL-E failure and advances the cursor", async () => {
  const originalFetch = globalThis.fetch;
  const dispatched: string[] = [];
  let advanced = false;
  let eventFailed = false;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/history?")) return Response.json({
      history: [{ messagesAdded: [{ message: { id: "message-a" } }, { message: { id: "message-b" } }] }],
      historyId: "12",
    });
    const id = url.includes("message-a") ? "message-a" : "message-b";
    return Response.json({ id, labelIds: ["INBOX"], payload: { headers: [{ name: "From", value: "alice@example.com" }] } });
  }) as typeof fetch;

  try {
    await runWorkerOnce(dependencies({
      listActiveTasks: async () => [{ id: "task-1", userId: "user-1", originalPrompt: "Call me when Alice emails", instruction: "Call me", phone: "+12025550123", senders: ["alice@example.com"] }],
      claimRun: async ({ messageId }) => ({ id: `run-${messageId}`, attempts: 0 }),
      dispatchCall: async ({ message }) => {
        dispatched.push(message.id);
        if (message.id === "message-a") throw new Error("CALL-E request failed with 400");
        return { id: "call-b" };
      },
      advanceCursor: async () => { advanced = true; },
      markEventFailed: async (_id, _error, retryAt) => { eventFailed = retryAt === null; },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(dispatched).toEqual(["message-a", "message-b"]);
  expect(advanced).toBe(true);
  expect(eventFailed).toBe(true);
});
