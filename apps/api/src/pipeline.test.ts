import { afterAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import {
  claimTaskCreation, claimTaskRun, completeTaskCreation, createTask, db, enqueueGmailNotification, getTask, getTaskRunDecision, initializeDatabase, listActiveWorkerTasks, listGmailConnections, markTaskRunDispatched, markTaskRunFailed,
  persistGmailMessage, saveCallTask, saveGmailConnection, updateCallTask, upsertUser,
} from "./db";
import { callTasks, taskRuns, users } from "./schema";

const userId = "pipeline-test-user";
const connectionId = "pipeline-connection";
const matched = { matches: true, confidence: "high" as const, reason: "The model matched the invoice email." };

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
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
  expect(await listActiveWorkerTasks("pipeline-second-connection")).toEqual([]);
  expect(await enqueueGmailNotification({ id: "notification-1", userId, gmailConnectionId: connectionId, pubsubMessageId: "pubsub-1", historyId: "11" })).toBe(true);
  expect(await enqueueGmailNotification({ id: "notification-replay", userId, gmailConnectionId: connectionId, pubsubMessageId: "pubsub-1", historyId: "11" })).toBe(false);
  const connection = { id: connectionId, userId, gmailAddress: "pipeline@gmail.com", encryptedRefreshToken: "test-only", grantedScopes: [], labelMap: {}, status: "connected" as const, historyId: "10", watchExpiration: null, lastSyncedAt: null };
  await persistGmailMessage(connection, { id: "message-1", sender: "alice@example.com", subject: "Invoice", snippet: "Invoice attached" });
  const run = await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-1", decision: matched });
  expect(run).not.toBeNull();
  await saveCallTask({ id: "call-1", userId, task: "Explain the invoice email", phone: "+12025550123", source: "gmail", status: "queued", taskRunId: run!.id });
  await markTaskRunDispatched(run!.id, "call-1");
  expect(await claimTaskRun({ taskId: "pipeline-task", notificationEventId: "notification-1", messageId: "message-1", decision: matched })).toBeNull();
  await updateCallTask({
    id: "call-1",
    status: "completed",
    result: { requested_action: "send_reply", send_confirmed: "yes", reply_instruction: "Thanks.", evidence: "The recipient said yes." },
    queueEmailReply: true,
  });
  expect((await db.select({ status: taskRuns.status }).from(taskRuns).where(eq(taskRuns.id, run!.id)))[0]?.status).toBe("completed");
  expect((await db.select({ replyStatus: callTasks.replyStatus }).from(callTasks).where(eq(callTasks.id, "call-1")))[0]?.replyStatus).toBe("pending");
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
  expect(await claimTaskCreation()).toMatchObject({ id: "creating-task", executionMode: "approval" });
  await completeTaskCreation({ id: "creating-task", parserModel: "test-model", question: "Which Independence Day emails should match?" });
  expect((await getTask(userId, "creating-task"))?.status).toBe("needs_clarification");

  const [first, second] = await Promise.all([
    createTask({ id: "race-task-1", userId, requestId: "same-request", prompt: "same", status: "parse_failed", parserModel: "test-model" }),
    createTask({ id: "race-task-2", userId, requestId: "same-request", prompt: "same", status: "parse_failed", parserModel: "test-model" }),
  ]);
  expect(first?.id).toBe(second?.id);
});
