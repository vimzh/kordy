"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Database, LayoutGrid, List, Phone, Plus } from "lucide-react";

import type { Contact } from "@/components/ContactsTable";
import { FlowComposer, type FlowDraft } from "@/components/FlowComposer";
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

type Trigger = {
  id: string;
  title: string;
  summary: string;
  recipient: string;
  mode: "Recurring" | "Trigger-based";
  source: string;
  context: string;
  cadence: string;
};

const demoTriggers: Trigger[] = [
  {
    id: "production-outage",
    title: "Production outage escalation",
    summary: "Call the on-call engineer when the production error rate crosses the safe threshold.",
    recipient: "Alex Morgan",
    mode: "Trigger-based",
    source: "Vercel",
    context: "Deployment health, function errors, and production availability.",
    cadence: "Runs continuously",
  },
  {
    id: "vip-email",
    title: "VIP customer email",
    summary: "Call Maya when a priority customer sends an urgent support email.",
    recipient: "Maya Shah",
    mode: "Trigger-based",
    source: "Gmail",
    context: "Unread inbox messages from the priority customer list.",
    cadence: "Runs continuously",
  },
  {
    id: "morning-market",
    title: "Morning market brief",
    summary: "Call me with a concise update when tracked stocks move materially before market open.",
    recipient: "You",
    mode: "Recurring",
    source: "Market data",
    context: "Watchlist movement, overnight news, and pre-market volume.",
    cadence: "Weekdays at 8:30 AM",
  },
  {
    id: "failed-payment",
    title: "Failed payment follow-up",
    summary: "Call the account owner when a high-value subscription payment fails.",
    recipient: "Rohan Mehta",
    mode: "Trigger-based",
    source: "Stripe",
    context: "Failed invoices above $1,000 for active business accounts.",
    cadence: "Runs continuously",
  },
  {
    id: "weekly-operations",
    title: "Weekly operations check-in",
    summary: "Call the operations lead with unresolved incidents and delayed work from the week.",
    recipient: "Priya Nair",
    mode: "Recurring",
    source: "Slack",
    context: "Open incident channels, owner updates, and overdue follow-ups.",
    cadence: "Fridays at 5:00 PM",
  },
  {
    id: "database-capacity",
    title: "Database capacity warning",
    summary: "Call the infrastructure owner before database storage reaches a critical level.",
    recipient: "Dev Patel",
    mode: "Trigger-based",
    source: "PostgreSQL",
    context: "Primary database storage, connection load, and replication lag.",
    cadence: "Runs continuously",
  },
];

function TriggerCard({ trigger }: { trigger: Trigger }) {
  return (
    <Link href={`/triggers/${trigger.id}`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="h-full gap-6 py-6">
        <CardHeader className="gap-4 px-6">
          <div className="flex items-start justify-between gap-4">
            <Badge variant={trigger.mode === "Recurring" ? "secondary" : "outline"}>
              {trigger.mode}
            </Badge>
            <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-base font-medium">{trigger.title}</CardTitle>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{trigger.summary}</p>
          </div>
        </CardHeader>
        <CardContent className="mt-auto space-y-4 px-6">
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground"><Phone className="size-4" /> Calls</dt>
              <dd className="truncate font-medium">{trigger.recipient}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground"><Database className="size-4" /> Source</dt>
              <dd className="truncate font-medium">{trigger.source}</dd>
            </div>
          </dl>
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">Source context</p>
            <p className="mt-1 line-clamp-2 text-sm leading-5">{trigger.context}</p>
          </div>
          <p className="text-xs text-muted-foreground">{trigger.cadence}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function TriggersOverview({ contacts }: { contacts: Contact[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [triggers, setTriggers] = useState(demoTriggers);
  const [dialogOpen, setDialogOpen] = useState(false);

  function addTrigger({ trigger, sources }: FlowDraft) {
    const mention = trigger.match(/@([^,]+?)(?:\s+when|$)/i)?.[1]?.trim();
    const recurring = /\b(every|daily|weekly|monthly|hourly)\b/i.test(trigger);

    setTriggers((current) => [
      {
        id: `trigger-${Date.now()}`,
        title: trigger.length > 56 ? `${trigger.slice(0, 53)}…` : trigger,
        summary: trigger,
        recipient: mention || "You",
        mode: recurring ? "Recurring" : "Trigger-based",
        source: sources.join(", ") || "No source selected",
        context: sources.length
          ? `Uses events and context from ${sources.join(", ")}.`
          : "No connected source context has been selected yet.",
        cadence: recurring ? "Uses the schedule in the prompt" : "Runs continuously",
      },
      ...current,
    ]);
    setDialogOpen(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Triggers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Voice-call workflows watching your connected sources.
          </p>
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
            <FlowComposer contacts={contacts} onCreate={addTrigger} />
          </DialogContent>
        </Dialog>
      </header>

      <section aria-labelledby="current-triggers-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="current-triggers-heading" className="font-medium">Current triggers</h2>
            <p className="text-sm text-muted-foreground">{triggers.length} active workflows</p>
          </div>
          <div className="flex rounded-lg border bg-background p-1" aria-label="Trigger view">
            <Button
              type="button"
              size="icon-sm"
              variant={view === "cards" ? "secondary" : "ghost"}
              aria-label="Card view"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
            >
              <LayoutGrid />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={view === "table" ? "secondary" : "ghost"}
              aria-label="Table view"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <List />
            </Button>
          </div>
        </div>

        {view === "cards" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {triggers.map((trigger) => <TriggerCard key={trigger.id} trigger={trigger} />)}
          </div>
        ) : (
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Trigger</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="pr-6">Schedule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggers.map((trigger) => (
                  <TableRow key={trigger.id}>
                    <TableCell className="max-w-80 pl-6">
                      <Link href={`/triggers/${trigger.id}`} className="block font-medium hover:underline">
                        {trigger.title}
                        <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{trigger.summary}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{trigger.recipient}</TableCell>
                    <TableCell><Badge variant="outline">{trigger.mode}</Badge></TableCell>
                    <TableCell>{trigger.source}</TableCell>
                    <TableCell className="pr-6 text-muted-foreground">{trigger.cadence}</TableCell>
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
