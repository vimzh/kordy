export type ProviderError = {
  status?: number | null;
  code?: string | null;
  message?: string | null;
  retryAfterSeconds?: number | null;
};

export type TranscriptTurn = {
  offset_seconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
};

export type CallAttempt = {
  id?: string;
  phone?: string;
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  transcript_turns?: TranscriptTurn[];
  provider_call_id?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
};

export type CallRecipient = {
  id?: string;
  phones?: string[];
  locale?: string | null;
  region?: string | null;
  status?: string;
  structured_result?: Record<string, unknown> | null;
  summary?: string | null;
  attempts?: CallAttempt[];
};

export type CallRecord = {
  id: string;
  task: string;
  phone: string;
  source: string;
  region?: string | null;
  locale?: string | null;
  status: string;
  summary?: string | null;
  result?: unknown;
  taskCompleted?: boolean | null;
  completionConfidence?: { score: number; label: string } | null;
  evidence?: string[];
  recipients?: CallRecipient[];
  answeredBy?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  providerEventId?: string | null;
  providerError?: ProviderError | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  retryAt?: string | null;
  availableAt?: string | null;
  replyStatus?: "not_requested" | "pending" | "sending" | "sent" | "failed" | string;
  replyMessageId?: string | null;
  replyError?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  taskRunId?: string | null;
  taskRunAttempts?: number | null;
  sourceEventId?: string | null;
  reconciliationAttempts?: number | null;
};

export type CallMetrics = {
  fired: number;
  completed: number;
  unanswered: number;
  failed: number;
  replies: number;
  budgetUsed: number;
  budgetLimit: number;
};

export function displaySource(source?: string | null) {
  return source ? source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

export function displayStatus(status?: string | null) {
  return status ? status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

export function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function outcome(call: CallRecord) {
  if (call.summary) return call.summary;
  if (call.failureMessage) return call.failureMessage;
  if (typeof call.result === "string") return call.result;
  if (call.taskCompleted === true) return "Call objective completed.";
  if (call.status === "calling" || call.status === "queued") return "Call is in progress.";
  return "No outcome recorded yet.";
}
