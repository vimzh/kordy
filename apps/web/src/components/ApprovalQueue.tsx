"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TaskRun } from "@/components/LogsTable";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function ApprovalQueue({ runs, onDecided }: { runs: TaskRun[]; onDecided: () => void }) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const pending = runs.filter((run) => run.approvalStatus === "pending");

  async function decide(id: string, decision: "approved" | "rejected") {
    setWorkingId(id);
    try {
      const response = await fetch(`${apiUrl}/task-runs/${id}/approval`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("Could not save approval");
      onDecided();
    } finally {
      setWorkingId(null);
    }
  }

  if (!pending.length) return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nothing is waiting for approval.</div>;

  return <div className="space-y-3">{pending.map((run) => (
    <div key={run.id} className="rounded-xl border bg-card p-4">
      <p className="font-medium">{run.subject || "Matching Gmail event"}</p>
      <p className="mt-1 text-sm text-muted-foreground">{run.sender || "Gmail"} · {run.taskPrompt}</p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => void decide(run.id, "approved")} disabled={workingId === run.id}>Approve call</Button>
        <Button size="sm" variant="outline" onClick={() => void decide(run.id, "rejected")} disabled={workingId === run.id}>Reject</Button>
      </div>
    </div>
  ))}</div>;
}
