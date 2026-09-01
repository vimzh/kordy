"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Mail, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/calls/CallsDashboard";
import { type CallAttempt, type CallRecord, displaySource, displayStatus, formatDate, outcome } from "@/components/calls/types";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function CallDetails({ callId, initialCall }: { callId: string; initialCall: CallRecord }) {
  const [call, setCall] = useState<CallRecord>(initialCall);
  const [retryingReply, setRetryingReply] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch(`${apiUrl}/calls/${encodeURIComponent(callId)}`, { credentials: "include" });
      const body = await response.json().catch(() => null) as { call?: CallRecord; error?: string } | CallRecord | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load this call");
      const nextCall = body && "call" in body ? body.call : body as CallRecord | null;
      if (!nextCall) throw new Error("Call not found");
      setCall(nextCall);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this call");
    }
  }

  async function retryReply() {
    setRetryingReply(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/calls/${encodeURIComponent(callId)}/retry-reply`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not retry the Gmail reply");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry the Gmail reply");
    } finally {
      setRetryingReply(false);
    }
  }

  const attempts = call.recipients?.flatMap((recipient) => recipient.attempts ?? []) ?? [];
  const retryAt = call.retryAt || call.availableAt;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm"><Link href="/calls"><ArrowLeft />Calls</Link></Button>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{displaySource(call.source)}</Badge><StatusBadge status={call.status} /></div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{call.taskName || "Call detail"}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{call.task}</p>
        </div>
        <p className="text-xs text-muted-foreground">Call ID<br /><span className="font-mono text-foreground">{call.id}</span></p>
      </header>

      {error ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div> : null}

      <section aria-labelledby="outcome-heading" className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 text-teal-700" /><div><h2 id="outcome-heading" className="font-medium">Outcome</h2><p className="mt-1 text-sm text-muted-foreground">{outcome(call)}</p></div></div>
        <dl className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Recipient" value={call.phone} />
          <Detail label="Answered by" value={displayStatus(call.answeredBy)} />
          <Detail label="Region and locale" value={[call.region, call.locale].filter(Boolean).join(" · ") || "Defaults"} />
          <Detail label="Provider attempts" value={String(attempts.length)} />
          <Detail label="Run retries" value={String(call.taskRunAttempts ?? 0)} />
          <Detail label="Started" value={formatDate(call.createdAt)} />
          <Detail label="Completed" value={formatDate(call.completedAt)} />
          <Detail label="Objective completed" value={call.taskCompleted == null ? "Not confirmed" : call.taskCompleted ? "Yes" : "No"} />
          <Detail label="Confidence" value={call.completionConfidence ? `${call.completionConfidence.label} · ${Math.round(call.completionConfidence.score * 100)}%` : "Not recorded"} />
          <Detail label="Reconciliation checks" value={String(call.reconciliationAttempts ?? 0)} />
        </dl>
      </section>

      <section aria-labelledby="trace-heading" className="rounded-xl border bg-card p-5">
        <h2 id="trace-heading" className="font-medium">Lifecycle</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <TraceLink label="Trigger" value={call.taskName || call.taskId || "Direct call"} href={call.taskId ? `/triggers/${call.taskId}` : null} />
          <TraceLink label="Source event" value={call.sourceEventId || call.providerEventId || displaySource(call.source)} href={call.taskRunId ? `/home#run-${call.taskRunId}` : null} />
          <TraceLink label="Trigger run" value={call.taskRunId || "Not linked"} href={call.taskRunId ? `/home#run-${call.taskRunId}` : null} />
        </div>
      </section>

      {call.evidence?.length ? (
        <section aria-labelledby="evidence-heading" className="rounded-xl border bg-card p-5"><h2 id="evidence-heading" className="font-medium">Evidence</h2><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{call.evidence.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" />{item}</li>)}</ul></section>
      ) : null}

      <StructuredOutcome call={call} />

      {(call.failureCode || call.failureMessage || call.providerError) ? (
        <section aria-labelledby="failure-heading" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <h2 id="failure-heading" className="font-medium text-destructive">Provider failure</h2>
          <p className="mt-2 text-sm">{call.providerError?.message || call.failureMessage || "The provider could not complete this call."}</p>
          <p className="mt-1 text-xs text-muted-foreground">Code: {call.providerError?.code || call.failureCode || "unknown"}{retryAt ? ` · Next retry ${formatDate(retryAt)}` : call.providerError?.retryAfterSeconds ? ` · Retry after ${call.providerError.retryAfterSeconds} seconds` : ""}</p>
        </section>
      ) : null}

      <section aria-labelledby="attempts-heading" className="space-y-3">
        <div><h2 id="attempts-heading" className="font-medium">Attempts and transcript</h2><p className="mt-1 text-sm text-muted-foreground">Elapsed time is measured from the start of each attempt.</p></div>
        {!attempts.length ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No provider attempts have been recorded.</div> : attempts.map((attempt, index) => <Attempt key={attempt.id || `${index}-${attempt.started_at}`} attempt={attempt} index={index} />)}
      </section>

      <section aria-labelledby="reply-heading" className="rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><Mail className="mt-0.5 size-4 text-muted-foreground" /><div><h2 id="reply-heading" className="font-medium">Gmail reply</h2><p className="mt-1 text-sm text-muted-foreground">Status: {displayStatus(call.replyStatus ?? "not requested")}{call.replyMessageId ? ` · Message ${call.replyMessageId}` : ""}</p>{call.replyError ? <p className="mt-1 text-sm text-destructive">{call.replyError}</p> : null}</div></div>
          {call.replyStatus === "failed" ? <Button size="sm" variant="outline" disabled={retryingReply} onClick={() => void retryReply()}><RotateCcw />{retryingReply ? "Queuing…" : "Retry reply"}</Button> : null}
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{value}</dd></div>; }

function StructuredOutcome({ call }: { call: CallRecord }) {
  const result = isRecord(call.result) ? call.result : call.recipients?.find((recipient) => recipient.structured_result)?.structured_result;
  if (!result || !Object.keys(result).length) return null;
  return (
    <section aria-labelledby="structured-outcome-heading" className="rounded-xl border bg-card p-5">
      <h2 id="structured-outcome-heading" className="font-medium">Structured outcome</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries(result).map(([key, value]) => <Detail key={key} label={key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} value={readableValue(value)} />)}</dl>
    </section>
  );
}

function TraceLink({ label, value, href }: { label: string; value: string; href: string | null }) {
  return <div className="rounded-lg bg-muted/45 p-3"><p className="text-xs font-medium text-muted-foreground">{label}</p>{href ? <Link className="mt-1 flex items-center gap-1 break-all text-sm font-medium hover:underline" href={href}>{value}<ExternalLink className="size-3" /></Link> : <p className="mt-1 break-all text-sm font-medium">{value}</p>}</div>;
}

function Attempt({ attempt, index }: { attempt: CallAttempt; index: number }) {
  const turns = attempt.transcript_turns ?? [];
  return (
    <article className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-medium">Attempt {index + 1}</span><Badge variant="outline">{displayStatus(attempt.status)}</Badge></div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{formatDate(attempt.started_at)}</span></div>
      {attempt.summary ? <p className="mt-3 text-sm text-muted-foreground">{attempt.summary}</p> : null}
      {attempt.failure_message ? <p className="mt-2 text-sm text-destructive">{attempt.failure_code ? `${attempt.failure_code}: ` : ""}{attempt.failure_message}</p> : null}
      {turns.length ? <ol className="mt-4 space-y-3 border-l pl-4">{turns.map((turn, turnIndex) => <li key={`${turn.offset_seconds ?? "unknown"}-${turnIndex}`} className="text-sm"><div className="flex items-baseline justify-between gap-3"><span className="font-medium">{turn.speaker === "bot" ? "Kordy" : turn.speaker === "user" ? "Recipient" : "Unknown"}</span><time className="text-xs tabular-nums text-muted-foreground">{elapsed(turn.offset_seconds)}</time></div><p className="mt-0.5 text-muted-foreground">{turn.text}</p></li>)}</ol> : <p className="mt-4 text-sm text-muted-foreground">No transcript was returned for this attempt.</p>}
    </article>
  );
}

function elapsed(seconds: number | null) {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function readableValue(value: unknown): string {
  if (value == null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readableValue).join(", ");
  if (isRecord(value)) return Object.entries(value).map(([key, nested]) => `${key.replaceAll("_", " ")}: ${readableValue(nested)}`).join(" · ");
  return String(value);
}
