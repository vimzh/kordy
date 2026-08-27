// Separate durable worker that turns queued Gmail notifications into idempotent CALL-E calls.
import { confirmedReplyInstruction, normalizePhone } from "./calle";
import { dispatchCalleCall as createCalleCall, hasCalleCallCapacity } from "./call-dispatch";
import {
  advanceSourceEvent, claimCalendarConnectionForPolling, claimIntegrationSourceEvent, claimIntegrationTaskRun, claimNotionConnectionForPolling, claimNotionTaskRun, claimPublicTaskForPolling, claimSourceEvent, claimTaskCreation, claimTaskRun, claimVercelConnectionForPolling, claimVercelTaskRun, completeNotionPoll, completeTaskCreation, completeVercelPoll, failTaskCreation, getGmailConnectionById, getTaskContext, getTaskRunDecision, initializeDatabase,
  claimApprovedTaskRun, claimPendingEmailReply, listActiveWorkerTasks, listGmailConnectionsNeedingWatchRenewal, markEmailReplyFailed, markEmailReplySent, markGmailReconnect,
  listActiveIntegrationTasks, listActiveNotionTasks, listActiveVercelTasks, markIntegrationReconnect, markNotionReconnect, markTaskRunDispatched, markTaskRunFailed, markVercelReconnect, persistGmailMessage, persistNotionPage, persistVercelDeployment, recordCalendarTaskEvent, recordPublicSignal, saveCallTask, saveGmailConnection,
  updateGmailCursor, updateGmailWatchExpiration, updateIntegrationMetadata,
} from "./db";
import { generateConfirmedEmailReply, generateNotionTaskContext, generateTaskContext, generateVercelTaskContext, matchGmailMessage, matchNotionPage, type NotionWorkerTask } from "./email-ai";
import {
  GmailApiError, decryptToken, encryptToken, getMessage, parseGmailMessage, refreshGmailAccessToken, sendGmailReply, watchInbox,
} from "./gmail";
import { runWorkerOnce, type WorkerConnection, type WorkerDependencies, type WorkerTask } from "./gmail-worker";
import { parseTaskPrompt, taskTriggerFromResult, TaskParserError, type TaskAgentContext } from "./task-agent";
import { VercelApiError, listFailedVercelDeployments, matchesVercelDeployment } from "./vercel";
import { NotionApiError, getNotionPageContent, listNotionPages, matchesNotionPage, refreshNotionToken } from "./notion";
import { evaluatePublicTrigger, publicSourceState, shouldFirePublicSignal } from "./public-sources";
import { listUpcomingCalendarEvents, matchesIntegrationTrigger, refreshCalendarToken } from "./integrations";

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!clientId || !clientSecret || !topicName) throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_PUBSUB_TOPIC");
  return { clientId, clientSecret, topicName };
}

function notionConfig() {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing NOTION_CLIENT_ID or NOTION_CLIENT_SECRET");
  return { clientId, clientSecret };
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
  const messages: import("./gmail").ParsedGmailMessage[] = [];
  const uniqueIds = [...new Set(ids)];
  for (let index = 0; index < uniqueIds.length; index += 10) {
    messages.push(...await Promise.all(uniqueIds.slice(index, index + 10).map(async (id) => parseGmailMessage(await getMessage(token, id, format)))));
  }
  return messages;
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
  canDispatchCall: (task) => task.executionMode === "approval" ? Promise.resolve(true) : hasCalleCallCapacity(task.userId),
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
  if (!run || !run.trigger || !run.action) return false;
  try {
    const trigger = run.trigger as import("./db").TaskTrigger;
    const action = run.action as import("./db").TaskAction;
    if (!await hasCalleCallCapacity(run.userId)) throw new Error("Daily CALL-E call limit reached");
    if (trigger.type === "deployment.failed") {
      const event = run.eventHeaders as { deploymentId?: string; projectName?: string; target?: string | null; gitCommitMessage?: string | null } | null;
      if (!event?.deploymentId || !event.projectName) throw new Error("Approved Vercel run is missing deployment context");
      const briefing = await generateVercelTaskContext({
        originalPrompt: run.originalPrompt,
        instruction: action.task,
        projectName: event.projectName,
        environment: event.target ?? null,
        commitMessage: event.gitCommitMessage ?? null,
      });
      const call = await createCalleCall({ task: briefing, phone: action.phone, userId: run.userId, eventId: `vercel:${event.deploymentId}:task:${run.taskId}` });
      await saveCallTask({ id: call.id, userId: run.userId, task: briefing, phone: action.phone, status: call.status, taskRunId: run.id });
      await markTaskRunDispatched(run.id, call.id);
      return true;
    }
    if (trigger.type === "notion.page.updated") {
      const event = run.eventHeaders as { pageId?: string; pageTitle?: string; pageUrl?: string } | null;
      if (!event?.pageId || !event.pageTitle) throw new Error("Approved Notion run is missing page context");
      const task: NotionWorkerTask = { originalPrompt: run.originalPrompt, instruction: action.task, pageIds: trigger.pageIds, pageTitles: trigger.pageTitles, keywords: trigger.keywords };
      const page = { id: event.pageId, title: event.pageTitle, url: event.pageUrl ?? "", lastEditedTime: "", content: run.eventSnippet ?? "" };
      const briefing = await generateNotionTaskContext(task, page, { matches: true, confidence: "high", reason: "Approved by the user." });
      const call = await createCalleCall({ task: briefing, phone: action.phone, userId: run.userId, eventId: `notion:${page.id}:task:${run.taskId}:approved` });
      await saveCallTask({ id: call.id, userId: run.userId, task: briefing, phone: action.phone, status: call.status, taskRunId: run.id });
      await markTaskRunDispatched(run.id, call.id);
      return true;
    }
    if (run.sourceKind === "public.signal" || run.sourceKind === "integration.event") {
      if (!run.eventSnippet) throw new Error("Approved public-data run is missing signal context");
      const briefing = `${action.task}\n\nSource event: ${run.eventSnippet}`;
      const call = await createCalleCall({ task: briefing, phone: action.phone, userId: run.userId, eventId: `${run.sourceKind === "public.signal" ? "public" : "integration"}:${run.id}` });
      await saveCallTask({ id: call.id, userId: run.userId, task: briefing, phone: action.phone, status: call.status, taskRunId: run.id });
      await markTaskRunDispatched(run.id, call.id);
      return true;
    }
    if (trigger.type !== "email.received") throw new Error(`Unsupported approved source: ${trigger.type}`);
    if (!run.gmailMessageId || !run.connectionId || !run.gmailAddress || !run.encryptedRefreshToken || !run.connectionStatus || !run.historyId) throw new Error("Approved Gmail run is missing connection context");
    const connection = connectionShape({ id: run.connectionId, userId: run.userId, gmailAddress: run.gmailAddress, encryptedRefreshToken: run.encryptedRefreshToken, grantedScopes: run.grantedScopes ?? [], labelMap: run.labelMap ?? {}, status: run.connectionStatus, historyId: run.historyId, watchExpiration: run.watchExpiration, lastSyncedAt: run.lastSyncedAt });
    const token = await getGmailAccessToken(connection);
    const message = parseGmailMessage(await getMessage(token, run.gmailMessageId, "full"));
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
    const stored = await getTaskContext(job.userId, { gmailConnectionId: job.gmailConnectionId, vercelConnectionId: job.vercelConnectionId, notionConnectionId: job.notionConnectionId, integrationConnectionId: job.integrationConnectionId });
    if (!stored.profile) throw new Error("The task owner is unavailable");
    if (job.gmailConnectionId && stored.gmail?.status !== "connected") throw new Error("The selected Gmail connection is unavailable");
    if (job.vercelConnectionId && stored.vercel?.status !== "connected") throw new Error("The selected Vercel connection is unavailable");
    if (job.notionConnectionId && stored.notion?.status !== "connected") throw new Error("The selected Notion connection is unavailable");
    if (job.integrationConnectionId && stored.integration?.status !== "connected") throw new Error("The selected integration connection is unavailable");
    const context: TaskAgentContext = {
      currentUser: { id: job.userId, email: stored.profile.email, name: stored.profile.name, defaultPhone: stored.profile.defaultPhone },
      gmail: { connected: stored.gmail?.status === "connected", email: stored.gmail?.gmailAddress ?? null, labels: Object.keys(stored.gmail?.labelMap ?? {}), labelIds: stored.gmail?.labelMap ?? {} },
      vercel: { connected: stored.vercel?.status === "connected", accountName: stored.vercel?.accountName ?? null, projects: stored.vercel?.projects ?? [] },
      notion: { connected: stored.notion?.status === "connected", workspaceName: stored.notion?.workspaceName ?? null, pages: stored.notion?.pages.map(({ id, title }) => ({ id, title })) ?? [] },
      integration: { connected: stored.integration?.status === "connected", provider: stored.integration?.provider ?? null, label: stored.integration?.label ?? null },
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
    const trigger = taskTriggerFromResult(parsed.result, context);
    await completeTaskCreation({
      id: job.id,
      parserModel: parsed.model,
      trigger,
      action: { type: "calle.call", targetType: target.type, ...(target.type === "contact" ? { targetId: target.contactId } : {}), targetName: target.type === "self" ? context.currentUser.name ?? "You" : contact?.name ?? "Contact", phone, task: parsed.result.action.task, executionMode: job.executionMode },
    });
  } catch (error) {
    const model = error instanceof TaskParserError && error.model ? error.model : process.env.TASK_AGENT_COMPLEX_MODEL ?? "gpt-5.6-luna";
    await failTaskCreation(job.id, model, error instanceof Error ? error.message : String(error));
  }
  return true;
}

async function processPublicSource() {
  const task = await claimPublicTaskForPolling();
  if (!task) return false;
  let runId: string | null = null;
  try {
    const signal = await evaluatePublicTrigger(task.trigger);
    const run = await recordPublicSignal(task, signal, publicSourceState(signal), shouldFirePublicSignal(task.publicSourceState, signal));
    if (run && !run.awaitingApproval) {
      runId = run.id;
      const briefing = `${task.action.task}\n\nPublic signal: ${signal.summary}`;
      const call = await createCalleCall({ task: briefing, phone: task.action.phone, userId: task.userId, eventId: `public:${run.id}` });
      await saveCallTask({ id: call.id, userId: task.userId, task: briefing, phone: task.action.phone, status: call.status, taskRunId: run.id });
      await markTaskRunDispatched(run.id, call.id);
    }
  } catch (error) {
    if (runId) await markTaskRunFailed(runId, error instanceof Error ? error.message : String(error), null);
    console.error(`Could not poll public source for task ${task.id}`, error);
  }
  return true;
}

function matchesIntegrationTask(task: Awaited<ReturnType<typeof listActiveIntegrationTasks>>[number], event: { provider: string; eventName: string; summary: string; occurredAt: string | null }) {
  return matchesIntegrationTrigger(task.trigger, { provider: event.provider, name: event.eventName, summary: event.summary, occurredAt: event.occurredAt ?? new Date().toISOString() }, task.activationAt);
}

async function processIntegrationEvent() {
  const event = await claimIntegrationSourceEvent();
  if (!event) return false;
  let failed = false;
  for (const task of await listActiveIntegrationTasks(event.connectionId)) {
    if (!matchesIntegrationTask(task, event)) continue;
    const run = await claimIntegrationTaskRun({ taskId: task.id, eventId: event.id, requiresApproval: task.action.executionMode === "approval", evidence: [`Matched ${event.provider} event ${event.eventName}`, "source:integration"] });
    if (!run || run.awaitingApproval) continue;
    try {
      const briefing = `${task.action.task}\n\nSource event: ${event.summary}`;
      const call = await createCalleCall({ task: briefing, phone: task.action.phone, userId: task.userId, eventId: `integration:${event.id}:task:${task.id}` });
      await saveCallTask({ id: call.id, userId: task.userId, task: briefing, phone: task.action.phone, status: call.status, taskRunId: run.id });
      await markTaskRunDispatched(run.id, call.id);
    } catch (error) {
      failed = true;
      await markTaskRunFailed(run.id, error instanceof Error ? error.message : String(error), null);
    }
  }
  await advanceSourceEvent(event.id, failed ? "One or more integration calls failed" : undefined, null);
  return true;
}

async function processGoogleCalendar() {
  const connection = await claimCalendarConnectionForPolling();
  if (!connection) return false;
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    const cachedToken = typeof connection.metadata.encryptedAccessToken === "string" ? connection.metadata.encryptedAccessToken : null;
    const cachedExpiry = typeof connection.metadata.accessTokenExpiresAt === "number" ? connection.metadata.accessTokenExpiresAt : 0;
    let accessToken: string;
    if (cachedToken && cachedExpiry > Date.now() + 60_000) {
      accessToken = decryptToken(cachedToken);
    } else {
      const token = await refreshCalendarToken(decryptToken(connection.encryptedCredential), clientId, clientSecret);
      accessToken = token.access_token;
      await updateIntegrationMetadata(connection.id, { encryptedAccessToken: encryptToken(accessToken), accessTokenExpiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
    }
    const [events, tasks] = await Promise.all([listUpcomingCalendarEvents(accessToken), listActiveIntegrationTasks(connection.id)]);
    const now = Date.now();
    for (const task of tasks) {
      for (const event of events) {
        const startsInMinutes = (new Date(event.occurredAt).getTime() - now) / 60_000;
        if (startsInMinutes < 0 || startsInMinutes > task.trigger.withinMinutes || !matchesIntegrationTask(task, { provider: "google_calendar", eventName: event.name, summary: event.summary, occurredAt: event.occurredAt })) continue;
        const run = await recordCalendarTaskEvent(connection, task, event);
        if (!run || run.awaitingApproval) continue;
        const briefing = `${task.action.task}\n\nCalendar event: ${event.summary}\nStarts: ${event.occurredAt}`;
        const call = await createCalleCall({ task: briefing, phone: task.action.phone, userId: task.userId, eventId: `calendar:${task.id}:${event.id}` });
        await saveCallTask({ id: call.id, userId: task.userId, task: briefing, phone: task.action.phone, status: call.status, taskRunId: run.id });
        await markTaskRunDispatched(run.id, call.id);
      }
    }
  } catch (error) {
    if (/Google (?:token refresh|Calendar request) failed \((?:400|401|403)\)/.test(error instanceof Error ? error.message : "")) await markIntegrationReconnect(connection.id);
    else console.error(`Could not poll Google Calendar ${connection.label}`, error);
  }
  return true;
}

let vercelRetryAfter = 0;
let notionRetryAfter = 0;

async function processNotionPages() {
  if (Date.now() < notionRetryAfter) return false;
  const connection = await claimNotionConnectionForPolling();
  if (!connection) return false;
  try {
    let accessToken = decryptToken(connection.encryptedAccessToken);
    let refreshToken = decryptToken(connection.encryptedRefreshToken);
    let pages: Awaited<ReturnType<typeof listNotionPages>>;
    try {
      pages = await listNotionPages(accessToken);
    } catch (error) {
      if (!(error instanceof NotionApiError) || error.status !== 401) throw error;
      const token = await refreshNotionToken({ refreshToken, ...notionConfig() });
      accessToken = token.access_token;
      refreshToken = token.refresh_token ?? refreshToken;
      pages = await listNotionPages(accessToken);
    }
    const tasks = await listActiveNotionTasks(connection.id);
    const changed = pages.filter((page) => new Date(page.lastEditedTime).getTime() > new Date(connection.pollSince).getTime()).reverse();
    for (const summary of changed) {
      const matchingTasks = tasks.filter((task) => matchesNotionPage(summary, task.trigger));
      if (!matchingTasks.length) continue;
      const page = await getNotionPageContent(accessToken, summary);
      const eventId = await persistNotionPage({ connection, page });
      if (!eventId) continue;
      let failed = false;
      for (const task of matchingTasks) {
        if (task.activationAt && new Date(page.lastEditedTime).getTime() < new Date(task.activationAt).getTime()) continue;
        if (task.action.executionMode !== "approval" && !await hasCalleCallCapacity(task.userId)) continue;
        const workerTask: NotionWorkerTask = { originalPrompt: task.originalPrompt, instruction: task.action.task, pageIds: task.trigger.pageIds, pageTitles: task.trigger.pageTitles, keywords: task.trigger.keywords };
        try {
          const decision = await matchNotionPage(workerTask, page);
          if (!decision.matches) continue;
          const run = await claimNotionTaskRun({ taskId: task.id, eventId, requiresApproval: task.action.executionMode === "approval", evidence: [decision.reason, `confidence:${decision.confidence}`, "source:notion"] });
          if (!run || run.awaitingApproval) continue;
          const briefing = await generateNotionTaskContext(workerTask, page, decision);
          const call = await createCalleCall({ task: briefing, phone: task.action.phone, userId: task.userId, eventId: `notion:${page.id}:${page.lastEditedTime}:task:${task.id}` });
          await saveCallTask({ id: call.id, userId: task.userId, task: briefing, phone: task.action.phone, status: call.status, taskRunId: run.id });
          await markTaskRunDispatched(run.id, call.id);
        } catch (error) {
          failed = true;
          console.error(`Could not process Notion task ${task.id}`, error);
        }
      }
      await advanceSourceEvent(eventId, failed ? "One or more Notion task evaluations failed" : undefined, null);
    }
    await completeNotionPoll(connection.id, connection.pollUntil, {
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken),
    }, pages.map(({ id, title, url }) => ({ id, title, url })));
  } catch (error) {
    if (error instanceof NotionApiError && (error.status === 401 || error.status === 403)) await markNotionReconnect(connection.id);
    else {
      notionRetryAfter = Date.now() + 30_000;
      console.error(`Could not poll Notion workspace ${connection.workspaceName}`, error);
    }
  }
  return true;
}

async function processVercelDeployments() {
  if (Date.now() < vercelRetryAfter) return false;
  const connection = await claimVercelConnectionForPolling();
  if (!connection) return false;
  try {
    const accessToken = decryptToken(connection.encryptedAccessToken);
    const deployments = await listFailedVercelDeployments(accessToken, connection.teamId, new Date(connection.pollSince));
    const tasks = await listActiveVercelTasks(connection.id);
    for (const deployment of deployments.sort((left, right) => left.created - right.created)) {
      const eventId = await persistVercelDeployment({ connection, deployment });
      if (!eventId) continue;
      let failed = false;
      for (const task of tasks) {
        if (task.activationAt && deployment.created < new Date(task.activationAt).getTime()) continue;
        if (!matchesVercelDeployment(deployment, task.trigger)) continue;
        if (task.action.executionMode !== "approval" && !await hasCalleCallCapacity(task.userId)) continue;
        const run = await claimVercelTaskRun({ taskId: task.id, eventId, requiresApproval: task.action.executionMode === "approval" });
        if (!run || run.awaitingApproval) continue;
        try {
          const briefing = await generateVercelTaskContext({
            originalPrompt: task.originalPrompt,
            instruction: task.action.task,
            projectName: deployment.name,
            environment: deployment.target,
            commitMessage: deployment.meta?.githubCommitMessage ?? deployment.meta?.gitlabCommitMessage ?? deployment.meta?.bitbucketCommitMessage ?? null,
          });
          const call = await createCalleCall({ task: briefing, phone: task.action.phone, userId: task.userId, eventId: `vercel:${deployment.uid}:task:${task.id}` });
          await saveCallTask({ id: call.id, userId: task.userId, task: briefing, phone: task.action.phone, status: call.status, taskRunId: run.id });
          await markTaskRunDispatched(run.id, call.id);
        } catch (error) {
          failed = true;
          await markTaskRunFailed(run.id, error instanceof Error ? error.message : String(error), null);
        }
      }
      await advanceSourceEvent(eventId, failed ? "One or more CALL-E calls failed" : undefined, null);
    }
    await completeVercelPoll(connection.id, connection.pollUntil);
  } catch (error) {
    if (error instanceof VercelApiError && (error.status === 401 || error.status === 403)) await markVercelReconnect(connection.id);
    else {
      vercelRetryAfter = Date.now() + 15_000;
      console.error(`Could not poll Vercel account ${connection.accountSlug}`, error);
    }
  }
  return true;
}

export async function startWorker(signal?: AbortSignal) {
  await initializeDatabase();
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  let nextRenewal = 0;
  while (!signal?.aborted) {
    if (Date.now() >= nextRenewal) {
      nextRenewal = Date.now() + (await renewWatches() ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
    }
    if (await processTaskCreation() || await processConfirmedEmailReply() || await processApprovedTaskRun() || await processIntegrationEvent() || await processGoogleCalendar() || await processPublicSource() || await processVercelDeployments() || await processNotionPages()) continue;
    if (!await runWorkerOnce(dependencies)) await Bun.sleep(1_000);
  }
}

if (import.meta.main) {
  startWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
