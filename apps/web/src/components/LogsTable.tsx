import Link from "next/link";
import type { Task } from "@/components/FlowComposer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type TaskRun = {
  id: string;
  taskId: string;
  taskPrompt: string;
  taskName?: string;
  status: "pending" | "calling" | "completed" | "failed" | "not_matched";
  approvalStatus?: "not_required" | "pending" | "approved" | "rejected" | "expired";
  approvalExpiresAt?: string | null;
  approvalDecidedAt?: string | null;
  approvalDecidedBy?: string | null;
  approvalDecidedByName?: string | null;
  approvalViewedAt?: string | null;
  sourceEventId?: string;
  sourceKind?: string;
  sourceEventHeaders?: Record<string, string | null> | null;
  sourceOccurredAt?: string | null;
  sourceProvider?: string;
  recipientName?: string | null;
  recipientPhone?: string | null;
  callObjective?: string | null;
  taskAction?: {
    targetName?: string;
    phone?: string;
    task?: string;
    executionMode?: "automatic" | "approval";
  } | null;
  executionMode?: "automatic" | "approval";
  sender?: string;
  subject?: string;
  snippet?: string;
  matchingEvidence?: string[];
  callId?: string;
  result?: unknown;
  error?: string;
  availableAt?: string | null;
  providerError?: {
    code?: string;
    message?: string;
    retryAfterSeconds?: number | null;
  } | null;
  callSource?: string | null;
  callSummary?: string | null;
  taskCompleted?: boolean | null;
  completionConfidence?: { score: number; label: string } | null;
  callEvidence?: string[];
  answeredBy?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  recipients?: Array<{
    attempts?: Array<{
      transcript_turns?: Array<{ offset_seconds: number | null; speaker: "bot" | "user" | "unknown"; text: string }>;
    }>;
  }>;
  createdAt: string;
  updatedAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function conclusion(run: TaskRun) {
  if (run.error) return run.error;
  if (run.callSummary) return run.callSummary;
  if (typeof run.result === "string") return run.result;
  if (run.result && typeof run.result === "object") return JSON.stringify(run.result);
  if (run.status === "not_matched") return run.matchingEvidence?.[0] ?? "The email did not match this trigger.";
  if (run.status === "calling") return "The call is in progress.";
  if (run.status === "pending") return "Waiting to start the call.";
  return "No call result was recorded.";
}

function transcript(run: TaskRun) {
  return run.recipients?.flatMap((recipient) => recipient.attempts ?? []).flatMap((attempt) => attempt.transcript_turns ?? []) ?? [];
}

export function LogsTable({ runs, tasks }: { runs: TaskRun[]; tasks: Task[] }) {
  const targets = new Map(tasks.map((task) => [task.id, task.action?.targetName ?? "Not resolved"]));

  if (!runs.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No trigger runs yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Trigger</TableHead>
            <TableHead>Triggered</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Conclusion</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} id={`run-${run.id}`} className="scroll-mt-6">
              <TableCell className="max-w-64 whitespace-normal font-medium"><Link href={`/triggers/${run.taskId}`} className="hover:underline">{run.taskPrompt}</Link></TableCell>
              <TableCell className="text-muted-foreground">
                <time dateTime={run.createdAt}>{dateFormatter.format(new Date(run.createdAt))}</time>
              </TableCell>
              <TableCell>{targets.get(run.taskId) ?? "You"}</TableCell>
              <TableCell className="max-w-72 whitespace-normal text-muted-foreground">
                {[run.sender, run.subject, run.snippet].filter(Boolean).join(" · ") || "Gmail event received"}
              </TableCell>
              <TableCell className="max-w-72 whitespace-normal">
                <p>{run.callId ? <Link href={`/calls/${run.callId}`} className="hover:underline">{conclusion(run)}</Link> : conclusion(run)}</p>
                {run.answeredBy || run.completionConfidence ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[run.answeredBy ? `Answered by ${run.answeredBy}` : null, run.completionConfidence ? `${run.completionConfidence.label} confidence` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {transcript(run).length ? (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium text-foreground">View transcript</summary>
                    <ol className="mt-2 space-y-1.5 border-l pl-3 text-muted-foreground">
                      {transcript(run).map((turn, index) => (
                        <li key={`${turn.offset_seconds ?? "unknown"}-${index}`}><span className="font-medium text-foreground">{turn.speaker === "bot" ? "Kordy" : turn.speaker === "user" ? "Recipient" : "Unknown"}:</span> {turn.text}</li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </TableCell>
              <TableCell>
                {run.sourceEventHeaders?.url || run.sourceEventHeaders?.pageUrl ? (
                  <a href={run.sourceEventHeaders.url || run.sourceEventHeaders.pageUrl || "#"} target="_blank" rel="noreferrer" className="rounded-md bg-muted px-2 py-1 text-xs hover:underline">{run.callSource?.replaceAll("_", " ") ?? run.sourceKind?.split(".")[0] ?? "Source"}</a>
                ) : <span className="rounded-md bg-muted px-2 py-1 text-xs">{run.callSource?.replaceAll("_", " ") ?? run.sourceKind?.split(".")[0] ?? "Pending"}</span>}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                  {run.status.replaceAll("_", " ")}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
