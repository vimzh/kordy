import { LoaderCircle } from "lucide-react";
import type { Task } from "@/components/FlowComposer";

export function TaskCreationCards({ tasks }: { tasks: Task[] }) {
  const creating = tasks.filter((task) => task.status === "creating" || task.status === "parsing");
  if (!creating.length) return null;
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{creating.map((task) => (
    <div key={task.id} className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 text-sm font-medium"><LoaderCircle className="size-4 animate-spin" />Creating flow</div>
      <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{task.originalPrompt}</p>
      <p className="mt-4 text-xs text-muted-foreground">Kordy is resolving the trigger, source, recipient, and execution mode.</p>
    </div>
  ))}</div>;
}
