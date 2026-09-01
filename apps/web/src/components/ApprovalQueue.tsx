"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Clock3, PhoneCall, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TaskRun } from "@/components/LogsTable";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function ApprovalQueue({ runs, onDecided }: { runs: TaskRun[]; onDecided: () => void }) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("60");
  const [savingExpiry, setSavingExpiry] = useState(false);
  const pending = runs.filter((run) => run.approvalStatus === "pending");
  const unread = pending.filter((run) => !run.approvalViewedAt);
  const decided = runs.filter((run) => run.approvalDecidedAt || run.approvalStatus === "expired").slice(0, 5);

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/profile`, { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { profile?: { approvalExpiryMinutes?: number }; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Could not load the approval expiry setting");
        if (active && body?.profile?.approvalExpiryMinutes) setExpiryMinutes(String(body.profile.approvalExpiryMinutes));
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load approval settings"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!unread.length) return;
    void fetch(`${apiUrl}/approvals/read`, { method: "POST", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "Could not mark approvals as read");
        }
        onDecided();
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not mark approvals as read"));
  }, [onDecided, unread.length]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setWorkingId(id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/task-runs/${id}/approval`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not save approval");
      onDecided();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save approval");
    } finally {
      setWorkingId(null);
    }
  }

  async function saveExpiry() {
    setSavingExpiry(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalExpiryMinutes: Number(expiryMinutes) }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not save the approval expiry setting");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save approval settings");
    } finally {
      setSavingExpiry(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-teal-700" aria-hidden="true" />
            <p className="text-sm font-medium">Approval safety window</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Unanswered requests expire without placing a call.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs font-medium" htmlFor="approval-expiry">
            Default expiry
            <select id="approval-expiry" value={expiryMinutes} onChange={(event) => setExpiryMinutes(event.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </label>
          <Button size="sm" variant="outline" disabled={savingExpiry} onClick={() => void saveExpiry()}>
            {savingExpiry ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="size-4" />{error}</p> : null}

      {!pending.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nothing is waiting for approval.</div>
      ) : (
        <div className="space-y-3">{pending.map((run) => <ApprovalCard key={run.id} run={run} working={workingId === run.id} onDecide={decide} />)}</div>
      )}

      {decided.length ? (
        <section aria-labelledby="recent-decisions-heading" className="space-y-2">
          <h3 id="recent-decisions-heading" className="text-sm font-medium">Recent decisions</h3>
          <div className="divide-y rounded-xl border bg-card">
            {decided.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">{run.taskName || run.taskPrompt}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{run.approvalStatus}</Badge>
                  {run.approvalStatus === "expired" ? "Expired automatically" : run.approvalDecidedByName || "You"} · {formatDate(run.approvalDecidedAt || run.approvalExpiresAt || run.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ApprovalCard({ run, working, onDecide }: { run: TaskRun; working: boolean; onDecide: (id: string, decision: "approved" | "rejected") => Promise<void> }) {
  const source = sourceLabel(run);
  const evidence = useMemo(() => run.matchingEvidence?.filter((item) => !item.startsWith("source:")) ?? [], [run.matchingEvidence]);

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{source}</Badge>
            {!run.approvalViewedAt ? <Badge className="bg-teal-700">New</Badge> : null}
          </div>
          <h3 className="mt-2 font-medium">{run.subject || run.taskName || `${source} event`}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{run.sender ? `${run.sender} · ` : ""}{run.snippet || "The source event matched this trigger."}</p>
        </div>
        {run.approvalExpiresAt ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Expires {formatDate(run.approvalExpiresAt)}</span>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
        <Evidence label="Call objective" value={run.taskAction?.task || run.callObjective || run.taskPrompt} />
        <Evidence label="Recipient" value={[run.taskAction?.targetName || run.recipientName, run.taskAction?.phone || run.recipientPhone].filter(Boolean).join(" · ") || "Saved trigger recipient"} />
        <Evidence label="Source event" value={run.sourceKind?.replaceAll("_", " ").replaceAll(".", " · ") || source} />
        <Evidence label="Execution" value="One call after your approval" />
      </dl>

      {evidence.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this matched</p>
          <ul className="mt-1 space-y-1 text-sm">{evidence.map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-teal-700" />{item}</li>)}</ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void onDecide(run.id, "approved")} disabled={working}><PhoneCall />Approve call</Button>
        <Button size="sm" variant="outline" onClick={() => void onDecide(run.id, "rejected")} disabled={working}><X />Reject</Button>
      </div>
    </article>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>;
}

function sourceLabel(run: TaskRun) {
  const source = run.sourceProvider || run.sourceEventHeaders?.provider || run.callSource || run.matchingEvidence?.find((item) => item.startsWith("source:"))?.slice(7) || run.sourceKind?.split(".")[0];
  return source ? source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Connected source";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
