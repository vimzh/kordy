// Durable Gmail event processing with database and CALL-E operations supplied by the server.
import {
  GmailApiError,
  getMessage,
  listHistory,
  parseGmailMessage,
  watchInbox,
  type GmailRule,
  type GmailWatch,
  type ParsedGmailMessage,
} from "./gmail";

export type SourceEvent = {
  id: string;
  connectionId: string;
  attempts: number;
};

export type WorkerConnection = {
  id: string;
  userId: string;
  emailAddress: string;
  historyId: string;
  topicName: string;
  lastSyncedAt: string;
};

export type WorkerTask = GmailRule & {
  id: string;
  userId: string;
  originalPrompt: string;
  instruction: string;
  phone: string;
  executionMode?: "automatic" | "approval";
  activationAt?: string;
};

export type WorkerRun = { id: string; attempts: number; awaitingApproval?: boolean };
export type WorkerMatchDecision = { matches: boolean; confidence: "low" | "medium" | "high"; reason: string };

export class WorkerDependencyError extends Error {
  constructor(message: string, public readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkerDependencyError";
  }
}

export interface WorkerDependencies {
  claimEvent(): Promise<SourceEvent | null>;
  loadConnection(connectionId: string): Promise<WorkerConnection | null>;
  getAccessToken(connection: WorkerConnection): Promise<string>;
  listActiveTasks(connectionId: string): Promise<WorkerTask[]>;
  persistMessage(connectionId: string, message: ParsedGmailMessage): Promise<void>;
  loadRunDecision(input: { eventId: string; taskId: string; messageId: string }): Promise<WorkerMatchDecision | null>;
  canDispatchCall(task: WorkerTask): Promise<boolean>;
  matchTask(task: WorkerTask, message: ParsedGmailMessage): Promise<WorkerMatchDecision>;
  // Atomically create the unique task/message run or resume it when retryable; return null for complete, terminal, or already-claimed runs.
  claimRun(input: { eventId: string; taskId: string; messageId: string; decision: WorkerMatchDecision; requiresApproval: boolean }): Promise<WorkerRun | null>;
  dispatchCall(input: { runId: string; eventId: string; task: WorkerTask; message: ParsedGmailMessage }): Promise<{ id: string }>;
  markRunComplete(runId: string, callId: string): Promise<void>;
  markRunFailed(runId: string, error: string, retryAt: Date | null): Promise<void>;
  advanceCursor(connectionId: string, historyId: string): Promise<void>;
  recoverMessages(connection: WorkerConnection, accessToken: string, format: "metadata" | "full"): Promise<ParsedGmailMessage[]>;
  resetWatch(connectionId: string, watch: GmailWatch): Promise<void>;
  markEventComplete(eventId: string): Promise<void>;
  markEventFailed(eventId: string, error: string, retryAt: Date | null): Promise<void>;
}

export function retryDisposition(error: unknown): "retry" | "reset-history" | "fatal" {
  if (error instanceof WorkerDependencyError) return error.retryable ? "retry" : "fatal";
  if (error instanceof GmailApiError) {
    if (error.status === 404) return "reset-history";
    if (error.status === 403) {
      try {
        const reason = (JSON.parse(error.responseBody) as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason;
        if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || reason === "backendError") return "retry";
      } catch {}
    }
    return error.status === 408 || error.status === 429 || error.status >= 500 ? "retry" : "fatal";
  }
  if (error instanceof TypeError) return "retry";
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : error instanceof Error ? Number(error.message.match(/\b(408|429|5\d\d)\b/)?.[1]) : 0;
  return status === 408 || status === 429 || status >= 500 ? "retry" : "fatal";
}

export function retryDelayMs(attempt: number, random = Math.random) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt)) + Math.floor(random() * 1_000);
}

export function callRetryAt(error: unknown, previousAttempts: number, now = Date.now(), random = Math.random) {
  return retryDisposition(error) === "retry" && previousAttempts < 7
    ? new Date(now + retryDelayMs(previousAttempts, random))
    : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class WorkerRetryError extends Error {
  constructor(message: string, public readonly retryAt: Date) {
    super(message);
  }
}

export function passesGmailRuleFilter(task: WorkerTask, message: ParsedGmailMessage) {
  const sender = (message.sender.match(/<([^>]+)>/)?.[1] ?? message.sender).trim().toLowerCase();
  const includesAll = (value: string, needles: string[]) => needles.every((needle) => value.toLowerCase().includes(needle.toLowerCase()));
  return (!task.senders?.length || task.senders.some((value) => value.toLowerCase() === sender))
    && includesAll(message.subject, task.subjectKeywords ?? [])
    && includesAll(`${message.snippet ?? ""}\n${message.body}`, task.bodyKeywords ?? [])
    && (task.labels ?? []).every((label) => message.labelIds.includes(label));
}

async function processMessage(
  deps: WorkerDependencies,
  event: SourceEvent,
  connection: WorkerConnection,
  tasks: WorkerTask[],
  message: ParsedGmailMessage,
) {
  let terminalFailure = false;
  await deps.persistMessage(connection.id, message);
  for (const task of tasks) {
    if (task.activationAt && message.receivedAt && new Date(message.receivedAt) < new Date(task.activationAt)) continue;
    const existingDecision = await deps.loadRunDecision({ eventId: event.id, taskId: task.id, messageId: message.id });
    const passesRules = passesGmailRuleFilter(task, message);
    const decision = existingDecision ?? (!passesRules
      ? { matches: false, confidence: "high" as const, reason: "The email failed an explicit sender, keyword, or label rule." }
      : !await deps.canDispatchCall(task)
        ? { matches: false, confidence: "high" as const, reason: "The event was skipped because the daily call budget is exhausted." }
        : await deps.matchTask(task, message));
    const run = await deps.claimRun({ eventId: event.id, taskId: task.id, messageId: message.id, decision, requiresApproval: task.executionMode === "approval" });
    if (!run || run.awaitingApproval) continue;
    try {
      const call = await deps.dispatchCall({ runId: run.id, eventId: event.id, task, message });
      await deps.markRunComplete(run.id, call.id);
    } catch (error) {
      const retryAt = callRetryAt(error, run.attempts);
      await deps.markRunFailed(run.id, errorMessage(error), retryAt);
      if (retryAt) throw new WorkerRetryError(errorMessage(error), retryAt);
      terminalFailure = true;
    }
  }
  return terminalFailure;
}

export async function runWorkerOnce(deps: WorkerDependencies) {
  const event = await deps.claimEvent();
  if (!event) return false;

  try {
    const connection = await deps.loadConnection(event.connectionId);
    if (!connection) throw new Error(`Gmail connection ${event.connectionId} was not found`);
    const accessToken = await deps.getAccessToken(connection);
    const tasks = await deps.listActiveTasks(connection.id);
    const format = tasks.length ? "full" : "metadata";
    let history: Awaited<ReturnType<typeof listHistory>>;

    try {
      history = await listHistory(accessToken, connection.historyId);
    } catch (error) {
      if (retryDisposition(error) !== "reset-history") throw error;
      let terminalFailure = false;
      for (const message of await deps.recoverMessages(connection, accessToken, format)) {
        terminalFailure = await processMessage(deps, event, connection, tasks, message) || terminalFailure;
      }
      await deps.resetWatch(connection.id, await watchInbox(accessToken, connection.topicName));
      if (terminalFailure) await deps.markEventFailed(event.id, "One or more CALL-E calls failed permanently", null);
      else await deps.markEventComplete(event.id);
      return true;
    }

    let terminalFailure = false;
    for (const messageId of history.messageIds) {
      terminalFailure = await processMessage(deps, event, connection, tasks, parseGmailMessage(await getMessage(accessToken, messageId, format))) || terminalFailure;
    }

    await deps.advanceCursor(connection.id, history.historyId);
    if (terminalFailure) await deps.markEventFailed(event.id, "One or more CALL-E calls failed permanently", null);
    else await deps.markEventComplete(event.id);
  } catch (error) {
    const shouldRetry = event.attempts < 8;
    const retryAt = error instanceof WorkerRetryError
      ? error.retryAt
      : shouldRetry && retryDisposition(error) === "retry" ? new Date(Date.now() + (error instanceof GmailApiError && error.retryAfterMs !== undefined ? error.retryAfterMs : retryDelayMs(event.attempts))) : null;
    await deps.markEventFailed(event.id, errorMessage(error), retryAt);
  }
  return true;
}

export async function runWorker(deps: WorkerDependencies, options: { signal?: AbortSignal; idleMs?: number } = {}) {
  while (!options.signal?.aborted) {
    if (!await runWorkerOnce(deps)) await Bun.sleep(options.idleMs ?? 1_000);
  }
}
