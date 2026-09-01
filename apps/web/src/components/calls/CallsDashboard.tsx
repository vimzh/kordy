"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDownToLine, ChevronLeft, ChevronRight, PhoneCall } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type CallMetrics, type CallRecord, displaySource, displayStatus, formatDate, outcome } from "@/components/calls/types";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

type Filters = { source: string; status: string; answeredBy: string; triggerId: string; recipient: string; from: string; to: string };
const emptyFilters: Filters = { source: "", status: "", answeredBy: "", triggerId: "", recipient: "", from: "", to: "" };

export function CallsDashboard({ initialCalls, initialMetrics, initialNextCursor }: { initialCalls: CallRecord[]; initialMetrics: CallMetrics | null; initialNextCursor: string | null }) {
  const [calls, setCalls] = useState<CallRecord[]>(initialCalls);
  const [metrics, setMetrics] = useState<CallMetrics | null>(initialMetrics);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    for (const [key, value] of Object.entries(appliedFilters)) if (value) params.set(key, filterValue(key, value));
    return params.toString();
  }, [appliedFilters, cursor]);

  const load = useCallback(async (requestQuery: string) => {
    try {
      const [callsResponse, metricsResponse] = await Promise.all([
        fetch(`${apiUrl}/calls?${requestQuery}`, { credentials: "include" }),
        fetch(`${apiUrl}/calls/metrics`, { credentials: "include" }),
      ]);
      const callsBody = await callsResponse.json().catch(() => null) as { calls?: CallRecord[]; items?: CallRecord[]; nextCursor?: string | null; error?: string } | null;
      const metricsBody = await metricsResponse.json().catch(() => null) as { metrics?: Omit<CallMetrics, "budgetUsed" | "budgetLimit">; budget?: { used: number; limit: number }; error?: string } | CallMetrics | null;
      if (!callsResponse.ok) throw new Error(callsBody?.error ?? "Could not load calls");
      if (!metricsResponse.ok) throw new Error(metricsBody && "error" in metricsBody ? metricsBody.error : "Could not load call metrics");
      setCalls(callsBody?.calls ?? callsBody?.items ?? []);
      setNextCursor(callsBody?.nextCursor ?? null);
      setMetrics(metricsBody && "metrics" in metricsBody ? metricsBody.metrics ? { ...metricsBody.metrics, budgetUsed: metricsBody.budget?.used ?? 0, budgetLimit: metricsBody.budget?.limit ?? 0 } : null : metricsBody as CallMetrics | null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(query); };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, query]);

  function queryFor(nextFilters: Filters, nextCursorValue: string | null) {
    const params = new URLSearchParams({ limit: "25" });
    if (nextCursorValue) params.set("cursor", nextCursorValue);
    for (const [key, value] of Object.entries(nextFilters)) if (value) params.set(key, filterValue(key, value));
    return params.toString();
  }

  function applyFilters() {
    setLoading(true);
    setError("");
    setCursor(null);
    setPreviousCursors([]);
    setAppliedFilters(filters);
    void load(queryFor(filters, null));
  }

  function resetFilters() {
    setLoading(true);
    setError("");
    setFilters(emptyFilters);
    setCursor(null);
    setPreviousCursors([]);
    setAppliedFilters(emptyFilters);
    void load(queryFor(emptyFilters, null));
  }

  function nextPage() {
    if (!nextCursor) return;
    setLoading(true);
    setError("");
    setPreviousCursors((current) => [...current, cursor]);
    setCursor(nextCursor);
    void load(queryFor(appliedFilters, nextCursor));
  }

  function previousPage() {
    setLoading(true);
    setError("");
    const copy = [...previousCursors];
    const previousCursor = copy.pop() ?? null;
    setPreviousCursors(copy);
    setCursor(previousCursor);
    void load(queryFor(appliedFilters, previousCursor));
  }

  const exportQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(appliedFilters)) if (value) params.set(key, filterValue(key, value));
    return params;
  }, [appliedFilters]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="mt-1 text-sm text-muted-foreground">Trace every trigger from source event to phone outcome.</p>
        </div>
        <div className="flex gap-2">
          <ExportLink format="csv" query={exportQuery} />
          <ExportLink format="json" query={exportQuery} />
        </div>
      </header>

      <Metrics metrics={metrics} />
      <CallFilters filters={filters} setFilters={setFilters} onApply={applyFilters} onReset={resetFilters} />

      {error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><span className="flex items-center gap-2"><AlertCircle className="size-4" />{error}</span><Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(""); void load(query); }}>Retry</Button></div> : null}

      {loading ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Loading calls…</div>
      ) : !calls.length ? (
        <div className="rounded-xl border border-dashed p-12 text-center"><PhoneCall className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No calls match these filters.</p><p className="mt-1 text-sm text-muted-foreground">Calls appear here after an automatic or approved trigger runs.</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40"><TableHead>Started</TableHead><TableHead>Source</TableHead><TableHead>Recipient</TableHead><TableHead>Outcome</TableHead><TableHead>Status</TableHead><TableHead>Reply</TableHead></TableRow></TableHeader>
            <TableBody>{calls.map((call) => (
              <TableRow key={call.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground"><Link className="font-medium text-foreground hover:underline" href={`/calls/${call.id}`}>{formatDate(call.createdAt)}</Link></TableCell>
                <TableCell><Badge variant="secondary">{displaySource(call.source)}</Badge></TableCell>
                <TableCell><p className="font-medium">{call.phone}</p><p className="text-xs text-muted-foreground">{[call.region, call.locale].filter(Boolean).join(" · ") || "Default locale"}</p></TableCell>
                <TableCell className="max-w-80 whitespace-normal"><Link href={`/calls/${call.id}`} className="line-clamp-2 hover:underline">{outcome(call)}</Link>{call.answeredBy ? <p className="mt-1 text-xs text-muted-foreground">Answered by {displayStatus(call.answeredBy)}</p> : null}</TableCell>
                <TableCell><StatusBadge status={call.status} />{call.providerError?.retryAfterSeconds ? <p className="mt-1 text-xs text-muted-foreground">Retry in {call.providerError.retryAfterSeconds}s</p> : null}</TableCell>
                <TableCell><Badge variant="outline">{displayStatus(call.replyStatus ?? "not requested")}</Badge></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={!previousCursors.length || loading} onClick={previousPage}><ChevronLeft />Previous</Button>
        <Button size="sm" variant="outline" disabled={!nextCursor || loading} onClick={nextPage}>Next<ChevronRight /></Button>
      </div>
    </div>
  );
}

function Metrics({ metrics }: { metrics: CallMetrics | null }) {
  const used = metrics?.budgetUsed ?? 0;
  const limit = metrics?.budgetLimit ?? 0;
  const percentage = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const values = [
    ["Fired", metrics?.fired ?? 0], ["Completed", metrics?.completed ?? 0], ["Unanswered", metrics?.unanswered ?? 0], ["Failed", metrics?.failed ?? 0], ["Replies", metrics?.replies ?? 0],
  ] as const;
  return (
    <section aria-label="Call summary" className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card sm:grid-cols-5 sm:divide-y-0">{values.map(([label, value]) => <div key={label} className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between text-sm"><span className="font-medium">24-hour call budget</span><span className="tabular-nums text-muted-foreground">{used} / {limit || "—"}</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="24-hour call budget used" aria-valuemin={0} aria-valuemax={limit || 1} aria-valuenow={used}><div className="h-full rounded-full bg-teal-700" style={{ width: `${percentage}%` }} /></div>
      </div>
    </section>
  );
}

function CallFilters({ filters, setFilters, onApply, onReset }: { filters: Filters; setFilters: (filters: Filters) => void; onApply: () => void; onReset: () => void }) {
  const set = (key: keyof Filters, value: string) => setFilters({ ...filters, [key]: value });
  return (
    <form className="rounded-xl border bg-card p-4" onSubmit={(event) => { event.preventDefault(); onApply(); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="Source"><select value={filters.source} onChange={(event) => set("source", event.target.value)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm"><option value="">All sources</option>{["gmail", "vercel", "notion", "github", "stripe", "google_calendar", "n8n", "weather", "sec", "usgs", "nasa", "fx", "india", "generic"].map((source) => <option key={source} value={source}>{displaySource(source)}</option>)}</select></Filter>
        <Filter label="Status"><select value={filters.status} onChange={(event) => set("status", event.target.value)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm"><option value="">All statuses</option>{["queued", "calling", "completed", "failed", "canceled", "unanswered"].map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></Filter>
        <Filter label="Answered by"><select value={filters.answeredBy} onChange={(event) => set("answeredBy", event.target.value)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm"><option value="">Anyone</option>{["human", "ivr", "voicemail", "unknown"].map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}</select></Filter>
        <Filter label="Trigger ID"><Input value={filters.triggerId} onChange={(event) => set("triggerId", event.target.value)} placeholder="Filter by trigger" /></Filter>
        <Filter label="Recipient"><Input value={filters.recipient} onChange={(event) => set("recipient", event.target.value)} placeholder="Phone number" /></Filter>
        <Filter label="From"><Input type="date" value={filters.from} onChange={(event) => set("from", event.target.value)} /></Filter>
        <Filter label="To"><Input type="date" value={filters.to} onChange={(event) => set("to", event.target.value)} /></Filter>
      </div>
      <div className="mt-4 flex gap-2"><Button size="sm" type="submit">Apply filters</Button><Button size="sm" variant="ghost" type="button" onClick={onReset}>Reset</Button></div>
    </form>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs font-medium text-muted-foreground">{label}{children}</label>; }

function ExportLink({ format, query }: { format: "csv" | "json"; query: URLSearchParams }) {
  const params = new URLSearchParams(query);
  params.set("format", format);
  return <Button asChild variant="outline" size="sm"><a href={`${apiUrl}/calls/export?${params}`}><ArrowDownToLine />{format.toUpperCase()}</a></Button>;
}

export function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" || status === "canceled" ? "destructive" : status === "completed" ? "secondary" : "outline";
  return <Badge variant={variant}>{displayStatus(status)}</Badge>;
}

function filterValue(key: string, value: string) {
  if (key === "from") return new Date(`${value}T00:00:00`).toISOString();
  if (key === "to") return new Date(`${value}T23:59:59.999`).toISOString();
  return value;
}
