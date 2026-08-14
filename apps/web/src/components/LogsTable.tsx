import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type LogEntry = {
  trigger: string;
  triggeredAt: string;
  triggeredBy: string;
  summary: string;
  conclusion: string;
  status: string;
  sources: string[];
};

export const demoLogs: LogEntry[] = [
  {
    trigger: "New contact added",
    triggeredAt: "Today, 4:42 PM",
    triggeredBy: "Vansh",
    summary: "Enriched a new contact and checked for an existing account match.",
    conclusion: "Contact added to the founder outreach sequence.",
    status: "Completed",
    sources: ["HubSpot"],
  },
  {
    trigger: "Weekly pipeline review",
    triggeredAt: "Today, 9:00 AM",
    triggeredBy: "Scheduled",
    summary: "Reviewed 24 active contacts for stalled conversations and missing follow-ups.",
    conclusion: "Five follow-ups were flagged for review.",
    status: "Completed",
    sources: ["Google Calendar"],
  },
  {
    trigger: "High-intent reply",
    triggeredAt: "Yesterday, 6:18 PM",
    triggeredBy: "Kordy",
    summary: "Analysed an inbound reply and gathered the relevant account context.",
    conclusion: "Waiting for approval before drafting a response.",
    status: "Needs review",
    sources: ["Gmail"],
  },
];

export function LogsTable({ logs = demoLogs }: { logs?: LogEntry[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Trigger</TableHead>
            <TableHead>Triggered</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Conclusion</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={`${log.trigger}-${log.triggeredAt}`}>
              <TableCell className="font-medium">{log.trigger}</TableCell>
              <TableCell className="text-muted-foreground">{log.triggeredAt}</TableCell>
              <TableCell>{log.triggeredBy}</TableCell>
              <TableCell className="max-w-72 whitespace-normal text-muted-foreground">
                {log.summary}
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal">{log.conclusion}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {log.sources.map((source) => (
                    <span key={source} className="rounded-md bg-muted px-2 py-1 text-xs">
                      {source}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                  {log.status}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
