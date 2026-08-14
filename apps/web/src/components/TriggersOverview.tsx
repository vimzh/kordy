"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Database, LayoutGrid, List, Pause, Phone, Play, Plus } from "lucide-react";

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function statusLabel(status: Task["status"]) {
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function sourceContext(task: Task) {
  if (!task.trigger) return task.clarificationQuestion ?? "Trigger details were not resolved.";
  const values = [
    ...task.trigger.senders,
    ...task.trigger.subjectKeywords,
    ...task.trigger.bodyKeywords,
    ...task.trigger.labels,
  ];
  return values.length ? values.join(", ") : "All incoming Gmail messages";
}

function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadTasks() {
      try {
        const response = await fetch(`${apiUrl}/tasks`, { credentials: "include" });
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
  }, []);

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

  return {
    tasks,
    loading,
    error,
    updatingId,
    addTask: (task: Task) => setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]),
    updateStatus,
  };
}

function TaskActions({
  task,
  updating,
  onStatus,
}: {
  task: Task;
  updating: boolean;
  onStatus: (status: Task["status"]) => void;
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
      {task.status !== "archived" ? (
        <Button type="button" size="sm" variant="ghost" disabled={updating} onClick={() => onStatus("archived")}>
          <Archive /> Archive
        </Button>
      ) : null}
    </div>
  );
}

function TriggerCard({
  task,
  updating,
  onStatus,
}: {
  task: Task;
  updating: boolean;
  onStatus: (status: Task["status"]) => void;
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
              {task.originalPrompt}
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
            <dd className="truncate font-medium">Gmail</dd>
          </div>
        </dl>
        <TaskActions task={task} updating={updating} onStatus={onStatus} />
      </CardContent>
    </Card>
  );
}

export function TriggersOverview({ contacts }: { contacts: Contact[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { tasks, loading, error, updatingId, addTask, updateStatus } = useTasks();

  function taskCreated(task: Task) {
    addTask(task);
    setDialogOpen(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Triggers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voice-call workflows watching your connected sources.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg"><Plus /> Create trigger</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create a trigger</DialogTitle>
              <DialogDescription>Describe who Kordy should call and what event to watch for.</DialogDescription>
            </DialogHeader>
            <FlowComposer contacts={contacts} onCreated={taskCreated} />
          </DialogContent>
        </Dialog>
      </header>

      <section aria-labelledby="current-triggers-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="current-triggers-heading" className="font-medium">Current triggers</h2>
            <p className="text-sm text-muted-foreground">{tasks.length} persisted workflows</p>
          </div>
          <div className="flex rounded-lg border bg-background p-1" aria-label="Trigger view">
            <Button type="button" size="icon-sm" variant={view === "cards" ? "secondary" : "ghost"} aria-label="Card view" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <LayoutGrid />
            </Button>
            <Button type="button" size="icon-sm" variant={view === "table" ? "secondary" : "ghost"} aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <List />
            </Button>
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
              <TriggerCard key={task.id} task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} />
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
                  <TableHead className="pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="max-w-80 pl-6">
                      <Link href={`/triggers/${encodeURIComponent(task.id)}`} className="block font-medium hover:underline">
                        {task.originalPrompt}
                        <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{sourceContext(task)}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{task.action?.targetName ?? "Not resolved"}</TableCell>
                    <TableCell><Badge variant="outline">{statusLabel(task.status)}</Badge></TableCell>
                    <TableCell>Gmail</TableCell>
                    <TableCell className="pr-6">
                      <TaskActions task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} />
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
  const { tasks, loading, error, updatingId, updateStatus } = useTasks();
  const task = tasks.find((item) => item.id === taskId);

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
            <Badge variant={task.status === "active" ? "secondary" : "outline"}>{statusLabel(task.status)}</Badge>
            <CardTitle className="text-xl font-semibold">{task.originalPrompt}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 px-6">
            <dl className="grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Calls</dt>
                <dd className="mt-1 text-sm">{task.action ? `${task.action.targetName} · ${task.action.phone}` : "Not resolved"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Source</dt>
                <dd className="mt-1 text-sm">Gmail</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Matching email context</dt>
                <dd className="mt-1 text-sm">{sourceContext(task)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Created</dt>
                <dd className="mt-1 text-sm"><time dateTime={task.createdAt}>{dateFormatter.format(new Date(task.createdAt))}</time></dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Last updated</dt>
                <dd className="mt-1 text-sm"><time dateTime={task.updatedAt}>{dateFormatter.format(new Date(task.updatedAt))}</time></dd>
              </div>
            </dl>
            <TaskActions task={task} updating={updatingId === task.id} onStatus={(status) => void updateStatus(task, status)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
