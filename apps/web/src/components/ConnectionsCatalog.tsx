"use client";

import { useState } from "react";
import { MessageSquare, Plus, Search } from "lucide-react";
import {
  SiAirtable,
  SiAsana,
  SiDiscord,
  SiDropbox,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiHubspot,
  SiJira,
  SiLinear,
  SiNotion,
  SiPostgresql,
  SiShopify,
  SiStripe,
  SiTrello,
  SiVercel,
  SiZapier,
  SiZoom,
} from "react-icons/si";
import { ConnectionCard } from "@/components/ConnectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const connections = [
  { name: "Gmail", description: "Read and send email through your Google account.", icon: SiGmail },
  { name: "Vercel", description: "Access projects, deployments, and build activity.", icon: SiVercel },
  { name: "Slack", description: "Work with channels, messages, and team activity.", icon: MessageSquare },
  { name: "GitHub", description: "Connect repositories, issues, and pull requests.", icon: SiGithub },
  { name: "Notion", description: "Search and update pages, databases, and workspace content.", icon: SiNotion },
  { name: "Google Drive", description: "Find and manage files across Google Drive.", icon: SiGoogledrive },
  { name: "Google Calendar", description: "View schedules and create calendar events.", icon: SiGooglecalendar },
  { name: "Dropbox", description: "Access shared files and folders in Dropbox.", icon: SiDropbox },
  { name: "HubSpot", description: "Work with contacts, companies, and sales activity.", icon: SiHubspot },
  { name: "Linear", description: "Create and track product issues and projects.", icon: SiLinear },
  { name: "Jira", description: "Manage tickets, boards, and engineering workflows.", icon: SiJira },
  { name: "Trello", description: "Read and update boards, lists, and cards.", icon: SiTrello },
  { name: "Discord", description: "Connect server channels and community messages.", icon: SiDiscord },
  { name: "Zoom", description: "Access meetings, recordings, and call details.", icon: SiZoom },
  { name: "Stripe", description: "Review customers, payments, and subscriptions.", icon: SiStripe },
  { name: "Shopify", description: "Connect products, orders, and store operations.", icon: SiShopify },
  { name: "Airtable", description: "Read and update records in Airtable bases.", icon: SiAirtable },
  { name: "Asana", description: "Manage projects, tasks, and team assignments.", icon: SiAsana },
  { name: "PostgreSQL", description: "Query data from a connected PostgreSQL database.", icon: SiPostgresql },
  { name: "Zapier", description: "Connect existing automations and app workflows.", icon: SiZapier },
] as const;

export function ConnectionsCatalog() {
  const [query, setQuery] = useState("");
  const visibleConnections = connections.filter((connection) =>
    connection.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-heading">Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect the tools Kordy can work with on your behalf.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <label className="relative sm:w-72">
            <span className="sr-only">Search connections</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search connections"
              className="h-9 pl-8"
            />
          </label>
          <Button type="button" size="lg">
            <Plus />
            New custom connection
          </Button>
        </div>
      </div>

      {visibleConnections.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleConnections.map((connection) => (
            <ConnectionCard key={connection.name} {...connection} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No connections match “{query}”.
        </div>
      )}
    </div>
  );
}
