// Reconciles persisted CALL-E calls when the provider webhook is delayed or lost.
import {
  answeredBy,
  calleProviderError,
  confirmedPhoneOwnership,
  confirmedReplyInstruction,
  type CalleCall,
  type CalleProviderError,
} from "./calle";
import { callRetryAt } from "./gmail-worker";

export type ReconciliationClaim = {
  id: string;
  userId: string;
  phone: string;
  source: string;
  attempts: number;
};

export type CallProjection = {
  id: string;
  status: string;
  summary?: string | null;
  result?: unknown;
  taskCompleted?: boolean | null;
  completionConfidence?: { score: number; label: string } | null;
  evidence?: string[];
  recipients?: NonNullable<CalleCall["recipients"]>;
  answeredBy?: ReturnType<typeof answeredBy>;
  failureCode?: string | null;
  failureMessage?: string | null;
  completedAt?: string | null;
  queueEmailReply?: boolean;
};

export type ReconciliationDependencies = {
  claim(): Promise<ReconciliationClaim | null>;
  getCall(id: string): Promise<CalleCall>;
  updateCall(call: CallProjection): Promise<void>;
  reschedule(id: string, retryAt: Date, error: string | null, providerError: CalleProviderError | null): Promise<void>;
  verifyPhone(userId: string, phone: string): Promise<void>;
  now?(): number;
};

const terminalStatuses = new Set(["completed", "failed", "canceled"]);

export async function reconcileOneCall(deps: ReconciliationDependencies) {
  const stored = await deps.claim();
  if (!stored) return false;
  const now = deps.now?.() ?? Date.now();
  try {
    const call = await deps.getCall(stored.id);
    if (call.id !== stored.id) throw new Error("CALL-E reconciliation returned a different call");
    const recipientType = answeredBy(call);
    const replyInstruction = call.status === "completed"
      ? confirmedReplyInstruction(call.structured_result, call.completion_confidence, recipientType, call.task_completed)
      : null;
    await deps.updateCall({
      id: call.id,
      status: call.status,
      summary: call.summary,
      result: call.structured_result,
      taskCompleted: call.task_completed,
      completionConfidence: call.completion_confidence,
      evidence: call.evidence,
      recipients: call.recipients,
      answeredBy: recipientType,
      failureCode: call.failure_code,
      failureMessage: call.failure_message,
      completedAt: call.completed_at,
      queueEmailReply: Boolean(replyInstruction),
    });
    if (stored.source === "verification" && confirmedPhoneOwnership(call)) await deps.verifyPhone(stored.userId, stored.phone);
    if (!terminalStatuses.has(call.status)) {
      const delay = Math.min(5 * 60_000, Math.max(30_000, stored.attempts * 30_000));
      await deps.reschedule(stored.id, new Date(now + delay), null, null);
    }
  } catch (error) {
    const retryAt = callRetryAt(error, Math.min(stored.attempts, 6), now) ?? new Date(now + 15 * 60_000);
    await deps.reschedule(stored.id, retryAt, error instanceof Error ? error.message : String(error), calleProviderError(error));
  }
  return true;
}
