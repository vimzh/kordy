import { expect, test } from "bun:test";
import { CalleApiError, type CalleCall } from "./calle";
import { reconcileOneCall, type CallProjection, type ReconciliationDependencies } from "./call-reconciliation";

const completedCall: CalleCall = {
  id: "call_1",
  status: "completed",
  task: "Call me",
  structured_result: { requested_action: "none" },
  task_completed: true,
  completion_confidence: { score: 0.9, label: "high" },
  recipients: [{ id: "recipient_1", phones: ["+12025550123"], locale: "en-US", region: "US", status: "completed", structured_result: { answered_by: "human" }, summary: "Done", attempts: [] }],
};

function dependencies(overrides: Partial<ReconciliationDependencies> = {}) {
  const updates: CallProjection[] = [];
  const schedules: Array<{ retryAt: Date; error: string | null }> = [];
  const deps: ReconciliationDependencies = {
    claim: async () => ({ id: "call_1", userId: "user_1", phone: "+12025550123", source: "gmail", attempts: 1 }),
    getCall: async () => completedCall,
    updateCall: async (call) => { updates.push(call); },
    reschedule: async (_id, retryAt, error) => { schedules.push({ retryAt, error }); },
    verifyPhone: async () => {},
    now: () => 1_000,
    ...overrides,
  };
  return { deps, updates, schedules };
}

test("projects a stale completed call without scheduling another outbound call", async () => {
  const { deps, updates, schedules } = dependencies();
  expect(await reconcileOneCall(deps)).toBe(true);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ id: "call_1", status: "completed", answeredBy: "human" });
  expect(schedules).toHaveLength(0);
});

test("reschedules a nonterminal provider result instead of redispatching", async () => {
  const { deps, updates, schedules } = dependencies({ getCall: async () => ({ ...completedCall, status: "calling" }) });
  await reconcileOneCall(deps);
  expect(updates[0]?.status).toBe("calling");
  expect(schedules[0]).toEqual({ retryAt: new Date(31_000), error: null });
});

test("honors provider Retry-After while leaving the existing call intact", async () => {
  const error = new CalleApiError({ status: 429, code: "rate_limit_exceeded", message: "Try later", details: {}, retryAfterSeconds: 12 });
  const { deps, updates, schedules } = dependencies({ getCall: async () => { throw error; } });
  await reconcileOneCall(deps);
  expect(updates).toHaveLength(0);
  expect(schedules[0]).toEqual({ retryAt: new Date(13_000), error: "CALL-E rate_limit_exceeded: Try later" });
});
