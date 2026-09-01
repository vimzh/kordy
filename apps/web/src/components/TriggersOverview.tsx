"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Copy, Database, Edit3, LayoutGrid, List, Pause, Phone, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import type { Contact } from "@/components/ContactsTable";
import { FlowComposer, type Task } from "@/components/FlowComposer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function statusLabel(status: Task["status"]) {
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function sourceContext(task: Task) {
  if (!task.trigger) return task.clarificationQuestion ?? "Trigger details were not resolved.";
  if (task.trigger.type === "deployment.failed") {
    const projects = task.trigger.projectNames.length ? task.trigger.projectNames.join(", ") : "all projects";
    const environments = task.trigger.environments.length ? task.trigger.environments.join(" and ") : "all environments";
    return `${projects} · ${environments}`;
  }
  if (task.trigger.type === "notion.page.updated") {
    const pages = task.trigger.pageTitles.length ? task.trigger.pageTitles.join(", ") : "all shared pages";
    return task.trigger.keywords.length ? `${pages} · ${task.trigger.keywords.join(", ")}` : `${pages} · any update`;
  }
  if (task.trigger.type === "integration.event") {
    const events = task.trigger.eventNames.length ? task.trigger.eventNames.join(", ") : "any event";
    const keywords = task.trigger.keywords.length ? ` · ${task.trigger.keywords.join(", ")}` : "";
    return task.trigger.provider === "google_calendar" ? `${events} · within ${task.trigger.withinMinutes} minutes${keywords}` : `${events}${keywords}`;
  }
  if (task.trigger.type === "weather.rain_forecast") return `${task.trigger.location} · at least ${task.trigger.minimumPrecipitationMm} mm within ${task.trigger.withinHours} hours`;
  if (task.trigger.type === "sec.filing.published") return `${task.trigger.companyName} · ${task.trigger.forms.join(", ")}`;
  if (task.trigger.type === "usgs.earthquake.detected") return `${task.trigger.location} · magnitude ${task.trigger.minimumMagnitude}+ within ${task.trigger.radiusKm} km`;
  if (task.trigger.type === "nasa.event.opened") return `${task.trigger.location || "Global"} · ${task.trigger.categories.join(", ")}`;
  if (task.trigger.type === "fx.rate.threshold") return `${task.trigger.base}/${task.trigger.quote} ${task.trigger.operator} ${task.trigger.threshold}`;
  if (task.trigger.type === "india.stock.price_threshold") return `${task.trigger.symbol}:${task.trigger.exchange} closes ${task.trigger.operator} ₹${task.trigger.price}`;
  if (task.trigger.type === "india.stock.daily_move") return `${task.trigger.symbol}:${task.trigger.exchange} · daily ${task.trigger.direction} of ${task.trigger.percent}%`;
  if (task.trigger.type === "india.stock.volume_threshold") return `${task.trigger.symbol}:${task.trigger.exchange} · daily volume of ${task.trigger.minimumVolume.toLocaleString("en-IN")}+`;
  const values = [
    ...task.trigger.senders,
    ...task.trigger.subjectKeywords,
    ...task.trigger.bodyKeywords,
    ...task.trigger.labels,
  ];
  return values.length ? values.join(", ") : "All incoming Gmail messages";
}

function sourceName(task: Task) {
  if (task.trigger?.type === "integration.event") return { github: "GitHub", stripe: "Stripe", google_calendar: "Google Calendar", n8n: "n8n" }[task.trigger.provider];
  const names: Record<NonNullable<Task["trigger"]>["type"], string> = {
    "email.received": "Gmail",
    "deployment.failed": "Vercel",
    "notion.page.updated": "Notion",
    "integration.event": "Integration",
    "weather.rain_forecast": "MET Norway",
    "sec.filing.published": "SEC EDGAR",
    "usgs.earthquake.detected": "USGS",
    "nasa.event.opened": "NASA EONET",
    "fx.rate.threshold": "Frankfurter",
    "india.stock.price_threshold": "Indian stocks (EOD)",
    "india.stock.daily_move": "Indian stocks (EOD)",
    "india.stock.volume_threshold": "Indian stocks (EOD)",
  };
  return task.trigger ? names[task.trigger.type] : "Not resolved";
}

function taskFromResponse(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { task?: unknown; id?: unknown };
  const task = record.task && typeof record.task === "object" ? record.task : record;
  return task && typeof (task as { id?: unknown }).id === "string" ? task as Task : null;
}

function useTasks(query = "", status = "all") {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadTasks() {
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("search", query.trim());
        if (status !== "all") params.set("status", status);
        const response = await fetch(`${apiUrl}/tasks${params.size ? `?${params}` : ""}`, { credentials: "include" });
        const result = (await response.json().catch(() => null)) as { tasks?: Task[]; error?: string } | null;
        if (!response.ok || !result?.tasks) throw new Error(result?.error ?? "Could not load triggers");
        if (active) setTasks(result.tasks);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load triggers");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTasks();
    return () => { active = false; };
  }, [query, status]);

  async function updateStatus(task: Task, status: Task["status"]) {
    setUpdatingId(task.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${task.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = (await response.json().catch(() => null)) as { task?: Task; error?: string } | Task | null;
      if (!response.ok || !result) {
        throw new Error(result && "error" in result ? result.error : "Could not update the trigger");
      }
      const updated = "id" in result ? result : result.task;
      if (!updated) throw new Error("The task API returned an invalid response");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the trigger");
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateTask(task: Task, update: Partial<Task>) {
    setUpdatingId(task.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${task.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
      if (!response.ok) throw new Error(result && "error" in result ? result.error : "Could not update the trigger");
      const updated = taskFromResponse(result);
      if (!updated) throw new Error("The task API returned an invalid response");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      return updated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the trigger");
      return null;
    } finally {
      setUpdatingId(null);
    }
  }

  async function duplicateTask(task: Task) {
    setUpdatingId(task.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${task.id}/duplicate`, { method: "POST", credentials: "include" });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
      if (!response.ok) throw new Error(result && "error" in result ? result.error : "Could not duplicate the trigger");
      const duplicated = taskFromResponse(result);
      if (!duplicated) throw new Error("The task API returned an invalid response");
      setTasks((current) => [duplicated, ...current]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not duplicate the trigger");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Permanently delete “${task.name || task.originalPrompt}”? This cannot be undone.`)) return;
    setUpdatingId(task.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${task.id}?confirm=true`, { method: "DELETE", credentials: "include" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not delete the trigger");
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the trigger");
    } finally {
      setUpdatingId(null);
    }
  }

  return {
    tasks,
    loading,
    error,
    updatingId,
    addTask: (task: Task) => setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]),
    updateStatus,
    updateTask,
    duplicateTask,
    deleteTask,
  };
}

function TaskActions({
  task,
  updating,
  onStatus,
  onDuplicate,
  onDelete,
}: {
  task: Task;
  updating: boolean;
  onStatus: (status: Task["status"]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {task.status === "active" ? (
        <Button type="button" size="sm" variant="outline" disabled={updating} onClick={() => onStatus("paused")}>
          <Pause /> Pause
        </Button>
      ) : task.status === "paused" ? (
        <Button type="button" size="sm" variant="outline" disabled={updating} onClick={() => onStatus("active")}>
          <Play /> Resume
        </Button>
      ) : null}
      {task.status === "archived" ? (
        <Button type="button" size="sm" variant="outline" disabled={updating} onClick={() => onStatus("active")}>
          <RotateCcw /> Unarchive
        </Button>
      ) : null}
      <Button asChild type="button" size="sm" variant="ghost">
        <Link href={`/triggers/${encodeURIComponent(task.id)}`}><Edit3 /> Edit</Link>
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={updating} onClick={onDuplicate}>
        <Copy /> Duplicate
      </Button>
      {task.status !== "archived" ? (
        <Button type="button" size="sm" variant="ghost" disabled={updating} onClick={() => onStatus("archived")}>
          <Archive /> Archive
        </Button>
      ) : null}
      {task.status === "archived" ? (
        <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={updating} onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      ) : null}
    </div>
  );
}

function TriggerCard({
  task,
  updating,
  onStatus,
  onDuplicate,
  onDelete,
}: {
  task: Task;
  updating: boolean;
  onStatus: (status: Task["status"]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="h-full gap-6 py-6">
      <CardHeader className="gap-4 px-6">
        <div className="flex items-start justify-between gap-4">
          <Badge variant={task.status === "active" ? "secondary" : "outline"}>{statusLabel(task.status)}</Badge>
          <Link
            href={`/triggers/${encodeURIComponent(task.id)}`}
            aria-label={`Open ${task.originalPrompt}`}
            className="rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-base font-medium">
            <Link href={`/triggers/${encodeURIComponent(task.id)}`} className="hover:underline">
              {task.name || task.originalPrompt}
            </Link>
          </CardTitle>
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{sourceContext(task)}</p>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-4 px-6">
        <dl className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-muted-foreground"><Phone className="size-4" /> Calls</dt>
            <dd className="truncate font-medium">{task.action?.targetName ?? "Not resolved"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-muted-foreground"><Database className="size-4" /> Source</dt>
            <dd className="truncate text-right font-medium">{sourceName(task)}{task.connection?.label ? <span className="block text-xs font-normal text-muted-foreground">{task.connection.label}</span> : null}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Execution</dt>
            <dd className="text-right font-medium">{task.executionMode === "approval" ? "Confirm before calling" : "Automatic"}</dd>
          </div>
        </dl>
        <TaskActions task={task} updating={updating} onStatus={onStatus} onDuplicate={onDuplicate} onDelete={onDelete} />
      </CardContent>
    </Card>
  );
}

export function TriggersOverview({ contacts }: { contacts: Contact[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const { tasks, loading, error, updatingId, addTask, updateStatus, duplicateTask, deleteTask } = useTasks(query, status);

  function taskCreated(task: Task) {
    addTask(task);
    setDialogOpen(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Triggers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voice-call workflows watching connected and public sources.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg"><Plus /> Create trigger</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create a trigger</DialogTitle>
              <DialogDescription>Describe who Kordy should call and what event to watch for.</DialogDescription>
            </DialogHeader>
            <FlowComposer contacts={contacts} onCreated={taskCreated} />
          </DialogContent>
        </Dialog>
      </header>

      <section aria-labelledby="current-triggers-heading" className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="current-triggers-heading" className="font-medium">Current triggers</h2>
            <p className="text-sm text-muted-foreground">{tasks.length} persisted workflows</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block">
              <span className="sr-only">Search triggers</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, sources, recipients…" className="h-11 w-full pl-9 sm:w-72" />
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40">
                <option value="all">All statuses</option>
                {(["creating", "parsing", "draft", "active", "paused", "needs_clarification", "parse_failed", "archived"] as const).map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
              </select>
            </label>
          <div className="flex rounded-lg border bg-background p-1" aria-label="Trigger view">
            <Button type="button" size="icon-sm" variant={view === "cards" ? "secondary" : "ghost"} aria-label="Card view" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <LayoutGrid />
            </Button>
            <Button type="button" size="icon-sm" variant={view === "table" ? "secondary" : "ghost"} aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <List />
            </Button>
          </div>
          </div>
        </div>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <div className="rounded-xl border p-8 text-sm text-muted-foreground">Loading triggers…</div>
        ) : !tasks.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No triggers yet.</div>
        ) : view === "cards" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => (
              <TriggerCard key={task.id} task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} onDuplicate={() => void duplicateTask(task)} onDelete={() => void deleteTask(task)} />
            ))}
          </div>
        ) : (
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Trigger</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Execution</TableHead>
                  <TableHead className="pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="max-w-80 pl-6">
                      <Link href={`/triggers/${encodeURIComponent(task.id)}`} className="block font-medium hover:underline">
                        {task.name || task.originalPrompt}
                        <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{sourceContext(task)}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{task.action?.targetName ?? "Not resolved"}</TableCell>
                    <TableCell><Badge variant="outline">{statusLabel(task.status)}</Badge></TableCell>
                    <TableCell>{sourceName(task)}</TableCell>
                    <TableCell>{task.executionMode === "approval" ? "Confirm before calling" : "Automatic"}</TableCell>
                    <TableCell className="pr-6">
                      <TaskActions task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} onDuplicate={() => void duplicateTask(task)} onDelete={() => void deleteTask(task)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}

export function TriggerDetails({ taskId }: { taskId: string }) {
  const { tasks, loading, error, updatingId, updateStatus, updateTask, duplicateTask, deleteTask } = useTasks();
  const task = tasks.find((item) => item.id === taskId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);

  async function save() {
    if (!task || !draft) return;
    const updated = await updateTask(task, {
      name: draft.name,
      trigger: draft.trigger,
      action: draft.action,
      executionMode: draft.executionMode,
      delivery: draft.delivery,
    });
    if (updated) {
      setDraft(updated);
      setEditing(false);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  function updateCondition(key: string, raw: string) {
    if (!draft?.trigger) return;
    const trigger = draft.trigger as unknown as Record<string, unknown>;
    const current = trigger[key];
    const value = Array.isArray(current)
      ? raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => typeof current[0] === "number" ? Number(item) : item)
      : typeof current === "number" ? Number(raw) : raw;
    setDraft({ ...draft, trigger: { ...draft.trigger, [key]: value } as Task["trigger"] });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost">
        <Link href="/triggers"><ArrowLeft /> Back to triggers</Link>
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">Loading trigger…</div>
      ) : !task ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Trigger not found.</div>
      ) : (
        <Card className="gap-6 py-6">
          <CardHeader className="gap-3 px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant={task.status === "active" ? "secondary" : "outline"}>{statusLabel(task.status)}</Badge>
              {!editing ? <Button type="button" variant="outline" onClick={() => { setDraft(task); setEditing(true); }}><Edit3 />Edit trigger</Button> : null}
            </div>
            <CardTitle className="text-xl font-semibold">{task.name || task.originalPrompt}</CardTitle>
            {task.name ? <p className="text-sm text-muted-foreground">{task.originalPrompt}</p> : null}
          </CardHeader>
          <CardContent className="space-y-6 px-6">
            {editing && draft ? (
              <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Trigger name</span>
                    <Input value={draft.name ?? ""} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Execution mode</span>
                    <select value={draft.executionMode} onChange={(event) => setDraft({ ...draft, executionMode: event.target.value as Task["executionMode"] })} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="approval">Confirm before calling</option>
                      <option value="automatic">Call automatically</option>
                    </select>
                  </label>
                </div>

                {draft.trigger ? (
                  <fieldset className="space-y-3 rounded-lg border p-4">
                    <legend className="px-1 text-sm font-medium">Condition</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(draft.trigger).filter(([key]) => key !== "type" && key !== "provider").map(([key, current]) => (
                        <label key={key} className="space-y-1.5 text-sm">
                          <span className="text-muted-foreground">{key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())}{Array.isArray(current) ? " (comma separated)" : ""}</span>
                          <Input type={typeof current === "number" ? "number" : "text"} value={Array.isArray(current) ? current.join(", ") : String(current)} onChange={(event) => updateCondition(key, event.target.value)} />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {draft.action ? (
                  <fieldset className="space-y-3 rounded-lg border p-4">
                    <legend className="px-1 text-sm font-medium">Call</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">Recipient</span><Input value={draft.action.targetName} onChange={(event) => setDraft({ ...draft, action: { ...draft.action!, targetName: event.target.value } })} /></label>
                      <label className="space-y-1.5 text-sm"><span className="text-muted-foreground">Phone</span><Input type="tel" inputMode="tel" value={draft.action.phone} onChange={(event) => setDraft({ ...draft, action: { ...draft.action!, phone: event.target.value } })} /></label>
                      <label className="space-y-1.5 text-sm sm:col-span-2"><span className="text-muted-foreground">Call objective</span><textarea className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm" value={draft.action.task} onChange={(event) => setDraft({ ...draft, action: { ...draft.action!, task: event.target.value } })} /></label>
                    </div>
                  </fieldset>
                ) : null}

                <fieldset className="space-y-3 rounded-lg border p-4">
                  <legend className="px-1 text-sm font-medium">Schedule and call limits</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ["timezone", "Timezone", "text"], ["quietHoursStart", "Quiet hours start", "time"], ["quietHoursEnd", "Quiet hours end", "time"],
                      ["cooldownMinutes", "Cooldown (minutes)", "number"], ["maxCallsPerHour", "Max calls per hour", "number"], ["maxCallsPerDay", "Max calls per day", "number"],
                      ["startsAt", "Starts at", "datetime-local"], ["expiresAt", "Expires at", "datetime-local"], ["locale", "Language / locale", "text"], ["region", "Call region", "text"],
                    ] as const).map(([key, label, type]) => (
                      <label key={key} className="space-y-1.5 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <Input type={type} min={type === "number" ? 0 : undefined} value={type === "datetime-local" && draft.delivery?.[key] ? String(draft.delivery[key]).slice(0, 16) : draft.delivery?.[key] ?? ""} onChange={(event) => setDraft({ ...draft, delivery: { ...draft.delivery, [key]: type === "number" && event.target.value ? Number(event.target.value) : event.target.value || undefined } })} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setDraft(null); setEditing(false); }}>Cancel</Button>
                  <Button type="submit" disabled={updatingId === task.id || !draft.name.trim()}>{updatingId === task.id ? "Saving…" : "Save changes"}</Button>
                </div>
              </form>
            ) : (
              <>
                <dl className="grid gap-5 sm:grid-cols-2">
                  <div><dt className="text-xs font-medium text-muted-foreground">Calls</dt><dd className="mt-1 text-sm">{task.action ? `${task.action.targetName} · ${task.action.phone}` : "Not resolved"}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Source</dt><dd className="mt-1 text-sm">{sourceName(task)}{task.connection?.label ? ` · ${task.connection.label}` : ""}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Execution mode</dt><dd className="mt-1 text-sm">{task.executionMode === "approval" ? "Confirm before calling" : "Call automatically"}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Call objective</dt><dd className="mt-1 text-sm">{task.action?.task ?? "Not resolved"}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Matching context</dt><dd className="mt-1 text-sm">{sourceContext(task)}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Schedule</dt><dd className="mt-1 text-sm">{task.delivery?.startsAt || task.delivery?.expiresAt ? `${task.delivery.startsAt ? `Starts ${task.delivery.startsAt}` : "Starts now"} · ${task.delivery.expiresAt ? `ends ${task.delivery.expiresAt}` : "no expiry"}` : "Always on"}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Quiet hours</dt><dd className="mt-1 text-sm">{task.delivery?.quietHoursStart && task.delivery?.quietHoursEnd ? `${task.delivery.quietHoursStart}–${task.delivery.quietHoursEnd} · ${task.delivery.timezone ?? "default timezone"}` : "Not set"}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Call limits</dt><dd className="mt-1 text-sm">{[`Cooldown ${task.delivery?.cooldownMinutes ?? 0} min`, task.delivery?.maxCallsPerHour ? `${task.delivery.maxCallsPerHour}/hour` : null, task.delivery?.maxCallsPerDay ? `${task.delivery.maxCallsPerDay}/day` : null].filter(Boolean).join(" · ")}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Language and region</dt><dd className="mt-1 text-sm">{[task.delivery?.locale, task.delivery?.region].filter(Boolean).join(" · ") || "Account defaults"}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Created</dt><dd className="mt-1 text-sm"><time dateTime={task.createdAt}>{dateFormatter.format(new Date(task.createdAt))}</time></dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Last updated</dt><dd className="mt-1 text-sm"><time dateTime={task.updatedAt}>{dateFormatter.format(new Date(task.updatedAt))}</time></dd></div>
                </dl>
                <TaskActions task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} onDuplicate={() => void duplicateTask(task)} onDelete={() => void deleteTask(task)} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
