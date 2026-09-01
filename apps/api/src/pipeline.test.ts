import { afterAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import {
  claimDispatchableTaskRun, claimSourceEvent, claimStaleCallForReconciliation, claimTaskCreation, claimTaskRun, completeTaskCreation, createTask, db, decideTaskRunApproval, enqueueGmailNotification, getGmailConnectionsByAddress, getTask, getTaskRunDecision, initializeDatabase, listActiveWorkerTasks, listCallTasks, listGmailConnections, markTaskRunDispatched, markTaskRunFailed,
  markApprovalsRead, persistGmailMessage, recordPublicSignal, saveCallTask, saveGmailConnection, taskDeliveryEligibility, unreadApprovalCount, updateCallTask, updateTask, upsertUser,
} from "./db";
import { callTasks, sourceEvents, taskRuns, tasks, users } from "./schema";

const userId = "pipeline-test-user";
const sharedUserId = "pipeline-shared-mailbox-user";
const connectionId = "pipeline-connection";
const callId = `pipeline-call-${crypto.randomUUID()}`;
const matched = { matches: true, confidence: "high" as const, reason: "The model matched the invoice email." };

afterAll(async () => {
  await db.delete(callTasks).where(eq(callTasks.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, sharedUserId));
});

test("a Gmail message can create only one task run even when its notification is replayed", async () => {
  await initializeDatabase();
  await db.delete(users).where(eq(users.id, userId));
  await upsertUser({ sub: userId, email: "pipeline@example.com", name: "Pipeline Test" });
  await saveGmailConnection({
    id: connectionId,
    userId,
    gmailAddress: "pipeline@gmail.com",
    encryptedRefreshToken: "test-only",
    grantedScopes: [],
    status: "connected",
    historyId: "10",
    watchExpiration: new Date(Date.now() + 86_400_000),
  });
  const task = await createTask({
    id: "pipeline-task",
    userId,
    requestId: "pipeline-request",
    prompt: "Call me when alice@example.com emails about invoice",
    status: "active",
    gmailConnectionId: connectionId,
    trigger: { type: "email.received", match: "and", senders: ["alice@example.com"], subjectKeywords: ["invoice"], bodyKeywords: [], labels: ["INBOX"] },
    action: { type: "calle.call", targetType: "self", targetName: "Test", phone: "+12025550123", task: "Explain the invoice email" },
    parserModel: "test-model",
  });
  expect(task?.status).toBe("active");
  await saveGmailConnection({ id: "pipeline-second-connection", userId, gmailAddress: "second@gmail.com", encryptedRefreshToken: "test-only", grantedScopes: [], status: "connected" });
  expect(await listGmailConnections(userId)).toHaveLength(2);
  await saveGmailConnection({ id: "pipeline-literal-connection", userId, gmailAddress: "alerts_1@example.com", encryptedRefreshToken: "test-only", grantedScopes: [], status: "connected" });
  await saveGmailConnection({ id: "pipeline-wildcard-decoy", userId, gmailAddress: "alertsx1@example.com", encryptedRefreshToken: "test-only", grantedScopes: [], status: "connected" });
  expect((await getGmailConnectionsByAddress("alerts_1@example.com")).map(({ id }) => id)).toEqual(["pipeline-literal-connection"]);
  expect(await listActiveWorkerTasks("pipeline-second-connection")).toEqual([]);
  expect(await enqueueGmailNotification({ id: "notification-1", userId, gmailConnectionId: connectionId, pubsubMessageId: "pubsub-1", historyId: "11" })).toBe(true);
  expect(await enqueueGmailNotification({ id: "notification-replay", userId, gmailConnectionId: connectionId, pubsubMessageId: "pubsub-1", historyId: "11" })).toBe(false);
  await upsertUser({ sub: sharedUserId, email: "shared-owner@example.com" });
  await saveGmailConnection({ id: "pipeline-shared-connection", userId: sharedUserId, gmailAddress: "pipeline@gmail.com", encryptedRefreshToken: "test-only", grantedScopes: [], status: "connected" });
  expect(await enqueueGmailNotification({ id: "notification-shared", userId: sharedUserId, gmailConnectionId: "pipeline-shared-connection", pubsubMessageId: "pubsub-1", historyId: "11" })).toBe(true);
  const connection = { id: connectionId, userId, gmailAddress: "pipeline@gmail.com", encryptedRefreshToken: "test-only", grantedScopes: [], labelMap: {}, status: "connected" as const, historyId: "10", watchExpiration: null, lastSyncedAt: null };
  await persistGmailMessage(connection, { id: "message-1", sender: "alice@example.com", subject: "Invoice", snippet: "Invoice attached" });
  const run = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-1", decision: matched });
  expect(run).not.toBeNull();
  await saveCallTask({ id: callId, userId, task: "Explain the invoice email", phone: "+12025550123", source: "gmail", status: "queued", taskRunId: run!.id });
  await markTaskRunDispatched(run!.id, callId);
  expect(await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-1", decision: matched })).toBeNull();
  await updateCallTask({
    id: callId,
    status: "completed",
    result: { requested_action: "send_reply", send_confirmed: "yes", reply_instruction: "Thanks.", evidence: "The recipient said yes." },
    queueEmailReply: true,
  });
  expect((await db.select({ status: taskRuns.status }).from(taskRuns).where(eq(taskRuns.id, run!.id)))[0]?.status).toBe("completed");
  expect((await db.select({ replyStatus: callTasks.replyStatus }).from(callTasks).where(eq(callTasks.id, callId)))[0]?.replyStatus).toBe("pending");
  expect((await listCallTasks(userId, { status: "unanswered" })).calls.map(({ id }) => id)).toContain(callId);
  const [{ value }] = await db.select({ value: count() }).from(taskRuns).where(eq(taskRuns.taskId, "pipeline-task"));
  expect(value).toBe(1);

  await persistGmailMessage(connection, { id: "message-retry", sender: "alice@example.com", subject: "Invoice" });
  const retryRun = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-retry", decision: matched });
  await markTaskRunFailed(retryRun!.id, "CALL-E rate limited the request", new Date(Date.now() - 1_000));
  const retriedClaims = await Promise.all([
    claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-retry", decision: matched }),
    claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-retry", decision: matched }),
  ]);
  expect(retriedClaims.filter(Boolean)).toHaveLength(1);
  expect(retriedClaims.find(Boolean)).toMatchObject({ id: retryRun!.id, attempts: 1 });

  await persistGmailMessage(connection, { id: "message-terminal", sender: "alice@example.com", subject: "Invoice" });
  const terminalRun = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-terminal", decision: matched });
  await markTaskRunFailed(terminalRun!.id, "CALL-E rejected the request", null);
  expect(await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-terminal", decision: matched })).toBeNull();

  await persistGmailMessage(connection, { id: "message-unrelated", sender: "newsletter@example.com", subject: "Weekly news" });
  const unrelated = { matches: false, confidence: "high" as const, reason: "The model found no invoice relevance." };
  expect(await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-unrelated", decision: unrelated })).toBeNull();
  expect(await getTaskRunDecision({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-unrelated" })).toEqual(unrelated);
  expect(await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-unrelated", decision: matched })).toBeNull();

  const creating = await createTask({ id: "creating-task", userId, requestId: "creating-request", prompt: "Call me about Independence Day emails", status: "creating", gmailConnectionId: connectionId, parserModel: "pending", executionMode: "approval" });
  expect(creating?.status).toBe("creating");
  await db.update(tasks).set({ createdAt: "2000-01-01T00:00:00.000Z" }).where(eq(tasks.id, "creating-task"));
  expect(await claimTaskCreation()).toMatchObject({ id: "creating-task", executionMode: "approval" });
  await completeTaskCreation({ id: "creating-task", parserModel: "test-model", question: "Which Independence Day emails should match?" });
  expect((await getTask(userId, "creating-task"))?.status).toBe("needs_clarification");

  const [first, second] = await Promise.all([
    createTask({ id: "race-task-1", userId, requestId: "same-request", prompt: "same", status: "parse_failed", parserModel: "test-model" }),
    createTask({ id: "race-task-2", userId, requestId: "same-request", prompt: "same", status: "parse_failed", parserModel: "test-model" }),
  ]);
  expect(first?.id).toBe(second?.id);

  expect(await enqueueGmailNotification({ id: "notification-stale", userId, gmailConnectionId: connectionId, pubsubMessageId: "pubsub-stale", historyId: "12" })).toBe(true);
  await db.update(sourceEvents).set({ processingState: "processing", createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" }).where(eq(sourceEvents.id, "notification-stale"));
  expect(await claimSourceEvent()).toMatchObject({ id: "notification-stale", attempts: 1 });

  const publicTrigger = { type: "fx.rate.threshold" as const, base: "USD", quote: "INR", operator: "above" as const, threshold: 90 };
  const publicAction = { type: "calle.call" as const, targetType: "self" as const, targetName: "Pipeline Test", phone: "+12025550123", task: "Explain the exchange-rate alert", executionMode: "automatic" as const };
  await createTask({ id: "public-retry-task", userId, requestId: "public-retry-request", prompt: "Call me when USD/INR rises above 90", status: "active", trigger: publicTrigger, action: publicAction, parserModel: "test-model" });
  const publicRun = await recordPublicSignal(
    { id: "public-retry-task", userId, trigger: publicTrigger, action: publicAction },
    { kind: "threshold", matched: true, fingerprint: "91", occurredAt: new Date().toISOString(), summary: "USD/INR is 91" },
    { matched: true, fingerprint: "91" },
    true,
  );
  await markTaskRunFailed(publicRun!.id, "CALL-E rate limited the request", new Date(Date.now() - 1_000));
  await db.update(taskRuns).set({ createdAt: "2000-01-01T00:00:00.000Z" }).where(eq(taskRuns.id, publicRun!.id));
  expect(await claimDispatchableTaskRun()).toMatchObject({ id: publicRun!.id, attempts: 1, sourceKind: "public.signal" });

  await persistGmailMessage(connection, { id: "message-approved-retry", sender: "alice@example.com", subject: "Invoice" });
  const approvedRun = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-approved-retry", decision: matched, requiresApproval: true });
  expect(await unreadApprovalCount(userId)).toBe(1);
  await markApprovalsRead(userId);
  expect(await unreadApprovalCount(userId)).toBe(0);
  expect(await decideTaskRunApproval(userId, approvedRun!.id, "approved")).toMatchObject({ id: approvedRun!.id, approvalStatus: "approved" });
  expect(await claimDispatchableTaskRun()).toMatchObject({ id: approvedRun!.id, attempts: 0, sourceKind: "gmail.message" });
  await markTaskRunFailed(approvedRun!.id, "CALL-E rate limited the approved call", new Date(Date.now() - 1_000));
  expect(await claimDispatchableTaskRun()).toMatchObject({ id: approvedRun!.id, attempts: 1, sourceKind: "gmail.message" });

  await persistGmailMessage(connection, { id: "message-reconcile", sender: "alice@example.com", subject: "Invoice" });
  const reconcileRun = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-reconcile", decision: matched });
  const reconcileCallId = `pipeline-reconcile-${crypto.randomUUID()}`;
  await saveCallTask({ id: reconcileCallId, userId, task: "Explain the invoice email", phone: "+12025550123", source: "gmail", status: "calling", taskRunId: reconcileRun!.id });
  await markTaskRunDispatched(reconcileRun!.id, reconcileCallId);
  await db.update(callTasks).set({ updatedAt: "2000-01-01T00:00:00.000Z", reconcileAvailableAt: "2000-01-01T00:00:00.000Z" }).where(eq(callTasks.id, reconcileCallId));
  const reconciliationClaims = await Promise.all([claimStaleCallForReconciliation(), claimStaleCallForReconciliation()]);
  expect(reconciliationClaims.filter((claim) => claim?.id === reconcileCallId)).toHaveLength(1);
  expect(reconciliationClaims.find((claim) => claim?.id === reconcileCallId)).toMatchObject({ userId, phone: "+12025550123", source: "gmail", attempts: 1 });
  await updateCallTask({ id: reconcileCallId, status: "completed", summary: "Done" });
  await updateCallTask({ id: reconcileCallId, status: "calling", summary: "Late stale response" });
  expect((await db.select({ status: callTasks.status, summary: callTasks.summary }).from(callTasks).where(eq(callTasks.id, reconcileCallId)))[0]).toEqual({ status: "completed", summary: "Done" });
  await updateTask(userId, "pipeline-task", { delivery: { maxCallsPerHour: 0, region: "IN", locale: "hi-IN" } });
  expect(await taskDeliveryEligibility("pipeline-task")).toMatchObject({ allowed: false, reason: "hourly_limit", delivery: { maxCallsPerHour: 0, region: "IN", locale: "hi-IN" } });
});
