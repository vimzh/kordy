// Separate durable worker that turns queued Gmail notifications into idempotent CALL-E calls.
import { confirmedReplyInstruction, createCalleCall, normalizePhone } from "./calle";
import {
  advanceSourceEvent, claimSourceEvent, claimTaskCreation, claimTaskRun, completeTaskCreation, failTaskCreation, getGmailConnectionById, getTaskContext, getTaskRunDecision, initializeDatabase,
  claimApprovedTaskRun, claimPendingEmailReply, listActiveWorkerTasks, listGmailConnectionsNeedingWatchRenewal, markEmailReplyFailed, markEmailReplySent, markGmailReconnect,
  markTaskRunDispatched, markTaskRunFailed, persistGmailMessage, saveCallTask, saveGmailConnection,
  updateGmailCursor, updateGmailWatchExpiration,
} from "./db";
import { generateConfirmedEmailReply, generateTaskContext, matchGmailMessage } from "./email-ai";
import {
  GmailApiError, decryptToken, encryptToken, getMessage, parseGmailMessage, refreshGmailAccessToken, sendGmailReply, watchInbox,
} from "./gmail";
import { runWorkerOnce, type WorkerConnection, type WorkerDependencies, type WorkerTask } from "./gmail-worker";
import { parseTaskPrompt, TaskParserError, type TaskAgentContext } from "./task-agent";

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!clientId || !clientSecret || !topicName) throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_PUBSUB_TOPIC");
  return { clientId, clientSecret, topicName };
}

export async function getGmailAccessToken(connection: WorkerConnection) {
  const stored = await getGmailConnectionById(connection.id);
  if (!stored?.encryptedRefreshToken || stored.status !== "connected") throw new Error("Gmail connection needs to be reconnected");
  try {
    const tokens = await refreshGmailAccessToken({ refreshToken: decryptToken(stored.encryptedRefreshToken), ...googleConfig() });
    if (tokens.refresh_token) await saveGmailConnection({
      id: stored.id,
      userId: stored.userId,
      gmailAddress: stored.gmailAddress,
      encryptedRefreshToken: encryptToken(tokens.refresh_token),
      grantedScopes: stored.grantedScopes,
      labelMap: stored.labelMap,
      status: "connected",
      historyId: stored.historyId,
      watchExpiration: stored.watchExpiration ? new Date(stored.watchExpiration) : null,
    });
    return tokens.access_token;
  } catch (error) {
    if (error instanceof GmailApiError && (error.status === 400 || error.status === 401)) await markGmailReconnect(connection.id);
    throw error;
  }
}

async function recentMessages(connection: WorkerConnection, token: string, format: "metadata" | "full") {
  const after = Math.floor(new Date(connection.lastSyncedAt).getTime() / 1000);
  if (!Number.isFinite(after)) throw new Error("Gmail recovery requires a valid last_synced_at cursor");
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ q: `in:inbox after:${after}`, maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new GmailApiError(response.status, await response.text());
    const body = await response.json() as { messages?: { id?: string }[]; nextPageToken?: string };
    for (const message of body.messages ?? []) if (message.id) ids.push(message.id);
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  if (pageToken) throw new Error("Gmail recovery exceeded the 500-message safety bound; manual resync is required");
  return Promise.all([...new Set(ids)].map(async (id) => parseGmailMessage(await getMessage(token, id, format))));
}

function connectionShape(stored: NonNullable<Awaited<ReturnType<typeof getGmailConnectionById>>>): WorkerConnection {
  if (!stored.historyId) throw new Error("Gmail connection has no history cursor");
  return {
    id: stored.id,
    userId: stored.userId,
    emailAddress: stored.gmailAddress,
    historyId: stored.historyId,
    topicName: googleConfig().topicName,
    lastSyncedAt: stored.lastSyncedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  };
}

const dependencies: WorkerDependencies = {
  claimEvent: claimSourceEvent,
  async loadConnection(connectionId) {
    const stored = await getGmailConnectionById(connectionId);
    return stored?.status === "connected" ? connectionShape(stored) : null;
  },
  getAccessToken: getGmailAccessToken,
  listActiveTasks: listActiveWorkerTasks,
  async persistMessage(connectionId, message) {
    const connection = await getGmailConnectionById(connectionId);
    if (!connection) throw new Error("Gmail connection disappeared while persisting a message");
    await persistGmailMessage(connection, message);
  },
  loadRunDecision: ({ eventId, taskId, messageId }) => getTaskRunDecision({ taskId, notificationEventId: eventId, messageId }),
  matchTask: matchGmailMessage,
  claimRun: ({ eventId, taskId, messageId, decision, requiresApproval }) => claimTaskRun({ taskId, notificationEventId: eventId, messageId, decision, requiresApproval }),
  async dispatchCall({ runId, eventId: notificationEventId, task, message }) {
    const callEventId = `gmail:${message.id}:task:${task.id}`;
    const decision = await getTaskRunDecision({ taskId: task.id, notificationEventId, messageId: message.id });
    if (!decision?.matches) throw new Error("Matched task run disappeared before CALL-E dispatch");
    const callTask = await generateTaskContext(task, message, decision);
    const call = await createCalleCall({ task: callTask, phone: task.phone, userId: task.userId, eventId: callEventId });
    await saveCallTask({ id: call.id, userId: task.userId, task: callTask, phone: task.phone, status: call.status, taskRunId: runId });
    return call;
  },
  markRunComplete: markTaskRunDispatched,
  markRunFailed: markTaskRunFailed,
  advanceCursor: updateGmailCursor,
  recoverMessages: recentMessages,
  resetWatch: (connectionId, watch) => updateGmailCursor(connectionId, watch.historyId, new Date(Number(watch.expiration))),
  markEventComplete: (eventId) => advanceSourceEvent(eventId),
  markEventFailed: (eventId, error, retryAt) => advanceSourceEvent(eventId, error, retryAt),
};

async function renewWatches() {
  let failed = false;
  for (const stored of await listGmailConnectionsNeedingWatchRenewal()) {
    try {
      const connection = connectionShape(stored);
      const watch = await watchInbox(await getGmailAccessToken(connection), connection.topicName);
      await updateGmailWatchExpiration(connection.id, new Date(Number(watch.expiration)));
    } catch (error) {
      failed = true;
      console.error(`Could not renew Gmail watch for ${stored.userId}`, error);
    }
  }
  return failed;
}

async function processConfirmedEmailReply() {
  const reply = await claimPendingEmailReply();
  if (!reply) return false;
  const replyInstruction = confirmedReplyInstruction(reply.result);
  if (!replyInstruction) {
    await markEmailReplyFailed(reply.callId, "CALL-E result did not contain an explicit send confirmation");
    return true;
  }
  try {
    const connection = connectionShape(reply.gmailConnection);
    const token = await getGmailAccessToken(connection);
    const rawMessage = await getMessage(token, reply.gmailMessageId, "full");
    const message = parseGmailMessage(rawMessage);
    const body = await generateConfirmedEmailReply({
      originalPrompt: reply.originalPrompt,
      instruction: reply.instruction,
      replyInstruction,
      message,
    });
    const sent = await sendGmailReply(token, { message: rawMessage, body });
    await markEmailReplySent(reply.callId, sent.id);
  } catch (error) {
    await markEmailReplyFailed(reply.callId, error instanceof Error ? error.message : String(error));
  }
  return true;
}

async function processApprovedTaskRun() {
  const run = await claimApprovedTaskRun();
  if (!run || !run.gmailMessageId || !run.trigger || !run.action) return false;
  try {
    const connection = connectionShape({ id: run.connectionId, userId: run.userId, gmailAddress: run.gmailAddress, encryptedRefreshToken: run.encryptedRefreshToken, grantedScopes: run.grantedScopes, labelMap: run.labelMap, status: run.connectionStatus, historyId: run.historyId, watchExpiration: run.watchExpiration, lastSyncedAt: run.lastSyncedAt });
    const token = await getGmailAccessToken(connection);
    const message = parseGmailMessage(await getMessage(token, run.gmailMessageId, "full"));
    const trigger = run.trigger as import("./db").TaskTrigger;
    const action = run.action as import("./db").TaskAction;
    const task: WorkerTask = { id: run.taskId, userId: run.userId, originalPrompt: run.originalPrompt, instruction: action.task, phone: action.phone, senders: trigger.senders, subjectKeywords: trigger.subjectKeywords, bodyKeywords: trigger.bodyKeywords, labels: trigger.labels };
    const briefing = await generateTaskContext(task, message, { matches: true, confidence: "high", reason: "Approved by the user." });
    const call = await createCalleCall({ task: briefing, phone: action.phone, userId: run.userId, eventId: `gmail:${message.id}:task:${run.taskId}` });
    await saveCallTask({ id: call.id, userId: run.userId, task: briefing, phone: action.phone, status: call.status, taskRunId: run.id });
    await markTaskRunDispatched(run.id, call.id);
  } catch (error) {
    await markTaskRunFailed(run.id, error instanceof Error ? error.message : String(error), null);
  }
  return true;
}

async function processTaskCreation() {
  const job = await claimTaskCreation();
  if (!job) return false;
  try {
    const stored = await getTaskContext(job.userId, job.gmailConnectionId);
    if (!stored.profile || !stored.gmail || stored.gmail.status !== "connected") throw new Error("The selected Gmail connection is unavailable");
    const context: TaskAgentContext = {
      currentUser: { id: job.userId, email: stored.profile.email, name: stored.profile.name, defaultPhone: stored.profile.defaultPhone },
      gmail: { connected: true, email: stored.gmail.gmailAddress, labels: Object.keys(stored.gmail.labelMap), labelIds: stored.gmail.labelMap },
      contacts: stored.contacts.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
    };
    const parsed = await parseTaskPrompt(job.prompt, context);
    if (parsed.result.status === "needs_clarification") {
      await completeTaskCreation({ id: job.id, question: parsed.result.question, context, parserModel: parsed.model });
      return true;
    }
    const target = parsed.result.action.target;
    const contact = target.type === "contact" ? context.contacts.find(({ id }) => id === target.contactId) : null;
    const phone = normalizePhone(target.type === "self" ? context.currentUser.defaultPhone ?? "" : contact?.phone ?? "");
    if (!phone) {
      await completeTaskCreation({ id: job.id, question: "What E.164 phone number should Kordy call?", context, parserModel: parsed.model });
      return true;
    }
    await completeTaskCreation({
      id: job.id,
      parserModel: parsed.model,
      trigger: {
        type: "email.received", match: "and",
        senders: parsed.result.trigger.rules.senders.map((value) => value.toLowerCase()),
        subjectKeywords: parsed.result.trigger.rules.subjectKeywords,
        bodyKeywords: parsed.result.trigger.rules.bodyKeywords,
        labels: parsed.result.trigger.rules.labels.map((name) => context.gmail.labelIds[name]!),
      },
      action: { type: "calle.call", targetType: target.type, ...(target.type === "contact" ? { targetId: target.contactId } : {}), targetName: target.type === "self" ? context.currentUser.name ?? "You" : contact?.name ?? "Contact", phone, task: parsed.result.action.task, executionMode: job.executionMode },
    });
  } catch (error) {
    const model = error instanceof TaskParserError && error.model ? error.model : process.env.TASK_AGENT_COMPLEX_MODEL ?? "gpt-5.6-luna";
    await failTaskCreation(job.id, model, error instanceof Error ? error.message : String(error));
  }
  return true;
}

export async function startWorker(signal?: AbortSignal) {
  await initializeDatabase();
  googleConfig();
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  let nextRenewal = 0;
  while (!signal?.aborted) {
    if (Date.now() >= nextRenewal) {
      nextRenewal = Date.now() + (await renewWatches() ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
    }
    if (await processTaskCreation() || await processConfirmedEmailReply() || await processApprovedTaskRun()) continue;
    if (!await runWorkerOnce(dependencies)) await Bun.sleep(1_000);
  }
}

if (import.meta.main) {
  startWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
