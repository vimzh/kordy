"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { Task } from "@/components/FlowComposer";
import { Button } from "@/components/ui/button";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function TaskCreationCards({ tasks, onTaskChanged }: { tasks: Task[]; onTaskChanged?: (task: Task) => void }) {
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visible = tasks.filter((task) => task.status === "creating" || task.status === "parsing" || task.status === "parse_failed");

  async function retry(task: Task) {
    setRetryingId(task.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${task.id}/retry`, { method: "POST", credentials: "include" });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | null;
      if (!response.ok || !result?.task) throw new Error(result?.error ?? "Could not retry parsing");
      let current = result.task;
      for (let attempt = 0; attempt < 120 && (current.status === "creating" || current.status === "parsing"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const poll = await fetch(`${apiUrl}/tasks/${task.id}`, { credentials: "include" });
        const body = await poll.json().catch(() => null) as { task?: Task; error?: string } | null;
        if (!poll.ok || !body?.task) throw new Error(body?.error ?? "Could not load the parsed trigger");
        current = body.task;
      }
      onTaskChanged?.(current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry parsing");
    } finally {
      setRetryingId(null);
    }
  }

  if (!visible.length) return null;
  return <div className="space-y-3">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map((task) => (
    <div key={task.id} className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 text-sm font-medium">{task.status === "parse_failed" ? <RefreshCw className="size-4" /> : <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{task.status === "parse_failed" ? "Parsing failed" : "Creating flow"}</div>
      <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{task.originalPrompt}</p>
      {task.status === "parse_failed" ? <Button type="button" size="sm" variant="outline" className="mt-4" disabled={retryingId === task.id} onClick={() => void retry(task)}><RefreshCw />{retryingId === task.id ? "Retrying…" : "Retry parsing"}</Button> : <p className="mt-4 text-xs text-muted-foreground">Kordy is resolving the trigger, source, recipient, and execution mode.</p>}
    </div>
  ))}</div></div>;
}
