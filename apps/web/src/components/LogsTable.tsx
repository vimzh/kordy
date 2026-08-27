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
  status: "pending" | "calling" | "completed" | "failed" | "not_matched";
  approvalStatus?: "not_required" | "pending" | "approved" | "rejected";
  sender?: string;
  subject?: string;
  snippet?: string;
  matchingEvidence?: string[];
  callId?: string;
  result?: unknown;
  error?: string;
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
            <TableRow key={run.id}>
              <TableCell className="max-w-64 whitespace-normal font-medium">{run.taskPrompt}</TableCell>
              <TableCell className="text-muted-foreground">
                <time dateTime={run.createdAt}>{dateFormatter.format(new Date(run.createdAt))}</time>
              </TableCell>
              <TableCell>{targets.get(run.taskId) ?? "You"}</TableCell>
              <TableCell className="max-w-72 whitespace-normal text-muted-foreground">
                {[run.sender, run.subject, run.snippet].filter(Boolean).join(" · ") || "Gmail event received"}
              </TableCell>
              <TableCell className="max-w-72 whitespace-normal">
                <p>{conclusion(run)}</p>
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
                <span className="rounded-md bg-muted px-2 py-1 text-xs">{run.callSource?.replaceAll("_", " ") ?? "Pending"}</span>
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
