"use client";

import { useEffect, useState } from "react";

import type { Contact } from "@/components/ContactsTable";
import { FlowComposer, type Task } from "@/components/FlowComposer";
import { LogsTable, type TaskRun } from "@/components/LogsTable";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskCreationCards } from "@/components/TaskCreationCards";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function TriggerLogs({ contacts }: { contacts: Contact[] }) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let polling = false;

    async function poll() {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const [runsResponse, tasksResponse] = await Promise.all([
          fetch(`${apiUrl}/task-runs`, { credentials: "include" }),
          fetch(`${apiUrl}/tasks`, { credentials: "include" }),
        ]);
        const [runsResult, tasksResult] = await Promise.all([
          runsResponse.json().catch(() => null) as Promise<{ runs?: TaskRun[]; error?: string } | null>,
          tasksResponse.json().catch(() => null) as Promise<{ tasks?: Task[]; error?: string } | null>,
        ]);
        if (!runsResponse.ok || !runsResult?.runs) throw new Error(runsResult?.error ?? "Could not load trigger runs");
        if (!tasksResponse.ok || !tasksResult?.tasks) throw new Error(tasksResult?.error ?? "Could not load triggers");
        if (active) {
          setRuns(runsResult.runs);
          setTasks(tasksResult.tasks);
          setError("");
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load trigger runs");
      } finally {
        polling = false;
        if (active) setLoading(false);
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function refresh() {
    const response = await fetch(`${apiUrl}/task-runs`, { credentials: "include" });
    const result = await response.json().catch(() => null) as { runs?: TaskRun[] } | null;
    if (response.ok && result?.runs) setRuns(result.runs);
  }

  function taskCreated(task: Task) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
  }

  return (
    <div className="space-y-8">
      <FlowComposer contacts={contacts} onCreated={taskCreated} />
      <TaskCreationCards tasks={tasks} />

      <section aria-labelledby="activity-heading" className="space-y-3">
        <div><h2 id="activity-heading" className="text-lg font-semibold">Activity</h2><p className="text-sm text-muted-foreground">Approve matched actions or review recent outcomes.</p></div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <div className="rounded-xl border p-8 text-sm text-muted-foreground">Loading trigger runs…</div>
        ) : (
          <Tabs defaultValue="approvals">
            <TabsList><TabsTrigger value="approvals">Approvals</TabsTrigger><TabsTrigger value="logs">Logs</TabsTrigger></TabsList>
            <TabsContent value="approvals" className="mt-4"><ApprovalQueue runs={runs} onDecided={() => void refresh()} /></TabsContent>
            <TabsContent value="logs" className="mt-4"><LogsTable runs={runs} tasks={tasks} /></TabsContent>
          </Tabs>
        )}
      </section>
    </div>
  );
}
