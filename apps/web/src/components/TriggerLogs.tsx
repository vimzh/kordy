"use client";

import { useState } from "react";

import type { Contact } from "@/components/ContactsTable";
import { FlowComposer, type FlowDraft } from "@/components/FlowComposer";
import { demoLogs, LogsTable, type LogEntry } from "@/components/LogsTable";

export function TriggerLogs({ contacts }: { contacts: Contact[] }) {
  const [logs, setLogs] = useState<LogEntry[]>(demoLogs);

  function addTrigger({ trigger, sources }: FlowDraft) {
    setLogs((current) => [
      {
        trigger,
        triggeredAt: "Just now",
        triggeredBy: "You",
        summary: `Watching for: ${trigger}`,
        conclusion: "Waiting for the trigger condition to be met.",
        status: "Watching",
        sources,
      },
      ...current,
    ]);
  }

  return (
    <div className="space-y-8">
      <FlowComposer contacts={contacts} onCreate={addTrigger} />

      <section aria-labelledby="logs-heading" className="space-y-3">
        <div>
          <h2 id="logs-heading" className="text-lg font-semibold">
            Logs table
          </h2>
          <p className="text-sm text-muted-foreground">Recent trigger runs and outcomes.</p>
        </div>
        <LogsTable logs={logs} />
      </section>
    </div>
  );
}
