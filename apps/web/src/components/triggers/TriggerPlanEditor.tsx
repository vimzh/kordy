"use client";

import { CheckCircle2, FlaskConical, X } from "lucide-react";
import { useState } from "react";

import type { Task } from "@/components/FlowComposer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function sourceName(task: Task) {
  if (task.trigger?.type === "integration.event") return { github: "GitHub", stripe: "Stripe", google_calendar: "Google Calendar", n8n: "n8n" }[task.trigger.provider];
  return task.trigger?.type === "email.received" ? "Gmail"
    : task.trigger?.type === "deployment.failed" ? "Vercel"
      : task.trigger?.type === "notion.page.updated" ? "Notion"
        : task.trigger?.type === "weather.rain_forecast" ? "Weather"
          : task.trigger?.type === "sec.filing.published" ? "SEC"
            : task.trigger?.type === "usgs.earthquake.detected" ? "USGS"
              : task.trigger?.type === "nasa.event.opened" ? "NASA EONET"
                : task.trigger?.type === "fx.rate.threshold" ? "Foreign Exchange"
                  : task.trigger ? "Indian stocks (EOD)" : "Not resolved";
}

function fieldLabel(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function updateTriggerField(task: Task, key: string, raw: string): Task {
  if (!task.trigger) return task;
  const current = (task.trigger as unknown as Record<string, unknown>)[key];
  let value: unknown = raw;
  if (Array.isArray(current)) value = raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => typeof current[0] === "number" ? Number(item) : item);
  else if (typeof current === "number") value = Number(raw);
  return { ...task, trigger: { ...task.trigger, [key]: value } as Task["trigger"] };
}

export function TriggerPlanEditor({
  task,
  onChange,
  onTest,
  onCancel,
  onActivate,
  busy,
  testing,
  testResult,
  error,
}: {
  task: Task;
  onChange: (task: Task) => void;
  onTest: () => void;
  onCancel: () => void;
  onActivate: () => void;
  busy: boolean;
  testing: boolean;
  testResult: string;
  error: string;
}) {
  const needsConfirmation = Boolean(task.parserAmbiguity) || (task.parserConfidence ?? 1) < 0.8;
  const [ambiguityConfirmed, setAmbiguityConfirmed] = useState(!needsConfirmation);

  return (
    <section aria-labelledby="trigger-preview-heading" className="space-y-5 rounded-xl border bg-card p-5 shadow-xs">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-primary">Review before activation</p>
          <h3 id="trigger-preview-heading" className="mt-1 text-lg font-semibold tracking-tight">Confirm the trigger plan</h3>
          <p className="mt-1 text-sm text-muted-foreground">Correct parsed fields here. The original request stays unchanged.</p>
        </div>
        <div className="rounded-lg bg-secondary px-3 py-2 text-right">
          <p className="text-xs text-muted-foreground">Parser confidence</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums">{Math.round((task.parserConfidence ?? 1) * 100)}%</p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Trigger name</span>
          <Input name="trigger-name" value={task.name ?? ""} maxLength={120} onChange={(event) => onChange({ ...task, name: event.target.value })} />
        </label>
        <div className="space-y-1.5 text-sm">
          <p className="font-medium">Watched account</p>
          <div className="min-h-8 rounded-md border bg-muted/40 px-3 py-2">
            <span>{sourceName(task)}</span><span className="text-muted-foreground"> · {task.connection?.label ?? "Public data source"}</span>
          </div>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Condition</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {task.trigger ? Object.entries(task.trigger).filter(([key]) => key !== "type" && key !== "provider").map(([key, current]) => (
            <label key={key} className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">{fieldLabel(key)}{Array.isArray(current) ? " (comma separated)" : ""}</span>
              <Input name={`trigger-${key}`} type={typeof current === "number" ? "number" : "text"} value={Array.isArray(current) ? current.join(", ") : String(current)} onChange={(event) => onChange(updateTriggerField(task, key, event.target.value))} />
            </label>
          )) : <p className="text-sm text-muted-foreground">No condition was resolved.</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Call</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">Recipient</span><Input value={task.action?.targetName ?? ""} onChange={(event) => onChange({ ...task, action: task.action ? { ...task.action, targetName: event.target.value } : null })} /></label>
          <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">Phone</span><Input type="tel" inputMode="tel" autoComplete="tel" value={task.action?.phone ?? ""} onChange={(event) => onChange({ ...task, action: task.action ? { ...task.action, phone: event.target.value } : null })} /></label>
          <label className="space-y-1.5 text-sm sm:col-span-2"><span className="text-muted-foreground">Call objective</span><textarea className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm" value={task.action?.task ?? ""} onChange={(event) => onChange({ ...task, action: task.action ? { ...task.action, task: event.target.value } : null })} /></label>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm text-muted-foreground">Execution mode</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["approval", "automatic"] as const).map((mode) => (
              <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
                <input type="radio" name="preview-execution-mode" checked={task.executionMode === mode} onChange={() => onChange({ ...task, executionMode: mode })} className="size-4 accent-primary" />
                {mode === "approval" ? "Confirm before calling" : "Call automatically"}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Schedule and call limits</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["timezone", "Timezone", "text", "Asia/Kolkata"], ["quietHoursStart", "Quiet hours start", "time", ""], ["quietHoursEnd", "Quiet hours end", "time", ""],
            ["cooldownMinutes", "Cooldown (minutes)", "number", "0"], ["maxCallsPerHour", "Max calls per hour", "number", ""], ["maxCallsPerDay", "Max calls per day", "number", ""],
            ["startsAt", "Starts at", "datetime-local", ""], ["expiresAt", "Expires at", "datetime-local", ""], ["locale", "Language / locale", "text", "en-IN"], ["region", "Call region", "text", "IN"],
          ] as const).map(([key, label, type, placeholder]) => (
            <label key={key} className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input type={type} min={type === "number" ? 0 : undefined} placeholder={placeholder} value={type === "datetime-local" && task.delivery?.[key] ? String(task.delivery[key]).slice(0, 16) : task.delivery?.[key] ?? ""} onChange={(event) => onChange({ ...task, delivery: { ...task.delivery, [key]: type === "number" && event.target.value ? Number(event.target.value) : event.target.value || undefined } })} />
            </label>
          ))}
        </div>
      </details>

      {needsConfirmation ? (
        <label className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ambiguityConfirmed} onChange={(event) => setAmbiguityConfirmed(event.target.checked)} />
          <span><span className="font-medium">Confirm the parser’s interpretation.</span><span className="mt-0.5 block">{task.parserAmbiguity ?? "Confidence is below the activation threshold."}</span></span>
        </label>
      ) : null}
      {testResult ? <p role="status" className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm"><CheckCircle2 className="size-4 text-primary" />{testResult}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={testing || busy} onClick={onTest}><FlaskConical />{testing ? "Testing…" : "Test with sample event"}</Button>
        <Button type="button" variant="ghost" disabled={testing || busy} onClick={onCancel}><X />Cancel and restart</Button>
        <Button type="button" className="ml-auto" disabled={busy || !task.name.trim() || !task.trigger || !task.action || (needsConfirmation && !ambiguityConfirmed)} onClick={onActivate}>{busy ? "Saving…" : "Activate trigger"}</Button>
      </div>
    </section>
  );
}
