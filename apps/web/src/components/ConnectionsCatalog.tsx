"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Plus, Search, Workflow } from "lucide-react";
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
import { WebhookConnectionDialog } from "@/components/WebhookConnectionDialog";

const connections = [
  { name: "Gmail", description: "Read and send email through your Google account.", icon: SiGmail },
  { name: "Vercel", description: "Access projects, deployments, and build activity.", icon: SiVercel },
  { name: "Slack", description: "Work with channels, messages, and team activity.", icon: MessageSquare },
  { name: "GitHub", description: "Watch repository, issue, pull request, and workflow events.", icon: SiGithub },
  { name: "Notion", description: "Search and update pages, databases, and workspace content.", icon: SiNotion },
  { name: "Google Drive", description: "Find and manage files across Google Drive.", icon: SiGoogledrive },
  { name: "Google Calendar", description: "Watch upcoming events in your primary calendar.", icon: SiGooglecalendar },
  { name: "Dropbox", description: "Access shared files and folders in Dropbox.", icon: SiDropbox },
  { name: "HubSpot", description: "Work with contacts, companies, and sales activity.", icon: SiHubspot },
  { name: "Linear", description: "Create and track product issues and projects.", icon: SiLinear },
  { name: "Jira", description: "Manage tickets, boards, and engineering workflows.", icon: SiJira },
  { name: "Trello", description: "Read and update boards, lists, and cards.", icon: SiTrello },
  { name: "Discord", description: "Connect server channels and community messages.", icon: SiDiscord },
  { name: "Zoom", description: "Access meetings, recordings, and call details.", icon: SiZoom },
  { name: "Stripe", description: "Watch payment, subscription, and dispute events.", icon: SiStripe },
  { name: "n8n", description: "Receive events from your existing n8n workflows.", icon: Workflow },
  { name: "Shopify", description: "Connect products, orders, and store operations.", icon: SiShopify },
  { name: "Airtable", description: "Read and update records in Airtable bases.", icon: SiAirtable },
  { name: "Asana", description: "Manage projects, tasks, and team assignments.", icon: SiAsana },
  { name: "PostgreSQL", description: "Query data from a connected PostgreSQL database.", icon: SiPostgresql },
  { name: "Zapier", description: "Connect existing automations and app workflows.", icon: SiZapier },
] as const;

type GmailConnection = {
  id: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  email: string;
  watchExpiration?: string;
};

type VercelConnection = {
  id: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  name: string;
  slug: string;
  projects: Array<{ id: string; name: string }>;
};

type NotionConnection = {
  id: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  name: string;
  icon: string | null;
  pages: Array<{ id: string; title: string }>;
};

type ConnectionFilter = "all" | "connected" | "unconnected";
type IntegrationProvider = "github" | "stripe" | "google_calendar" | "n8n";
type IntegrationConnection = { id: string; provider: IntegrationProvider; label: string; status: "connected" | "needs_reconnect" | "disconnected"; webhookUrl?: string };
const integrationNames: Record<IntegrationProvider, string> = { github: "GitHub", stripe: "Stripe", google_calendar: "Google Calendar", n8n: "n8n" };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function ConnectionsCatalog() {
  const [query, setQuery] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>("all");
  const [gmailConnections, setGmailConnections] = useState<GmailConnection[]>([]);
  const [vercelConnections, setVercelConnections] = useState<VercelConnection[]>([]);
  const [notionConnections, setNotionConnections] = useState<NotionConnection[]>([]);
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [setupProvider, setSetupProvider] = useState<"github" | "stripe" | "n8n" | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleConnections = connections.filter((connection) => {
    const matchesQuery = connection.name.toLowerCase().includes(normalizedQuery)
      || (connection.name === "Gmail" && gmailConnections.some((gmail) => gmail.email.toLowerCase().includes(normalizedQuery)))
      || (connection.name === "Vercel" && vercelConnections.some((vercel) => `${vercel.name} ${vercel.slug}`.toLowerCase().includes(normalizedQuery)))
      || (connection.name === "Notion" && notionConnections.some((notion) => notion.name.toLowerCase().includes(normalizedQuery)));
    const integrationProvider = (Object.entries(integrationNames).find(([, name]) => name === connection.name)?.[0] ?? null) as IntegrationProvider | null;
    const hasConnection = connection.name === "Gmail"
      ? gmailConnections.some((item) => item.status === "connected")
      : connection.name === "Vercel" ? vercelConnections.some((item) => item.status === "connected")
        : connection.name === "Notion" ? notionConnections.some((item) => item.status === "connected")
          : integrationProvider ? integrationConnections.some((item) => item.provider === integrationProvider && item.status === "connected") : false;
    return matchesQuery && (connectionFilter === "all" || (connectionFilter === "connected" ? hasConnection : !hasConnection));
  });

  useEffect(() => {
    let active = true;

    async function loadConnections() {
      try {
        const [gmailResponse, vercelResponse, notionResponse, integrationResponse] = await Promise.all([
          fetch(`${apiUrl}/connections/gmail`, { credentials: "include" }),
          fetch(`${apiUrl}/connections/vercel`, { credentials: "include" }),
          fetch(`${apiUrl}/connections/notion`, { credentials: "include" }),
          fetch(`${apiUrl}/connections/integrations`, { credentials: "include" }),
        ]);
        const [gmailResult, vercelResult, notionResult, integrationResult] = await Promise.all([
          gmailResponse.json().catch(() => null) as Promise<{ connections?: GmailConnection[]; error?: string } | null>,
          vercelResponse.json().catch(() => null) as Promise<{ connections?: VercelConnection[]; error?: string } | null>,
          notionResponse.json().catch(() => null) as Promise<{ connections?: NotionConnection[]; error?: string } | null>,
          integrationResponse.json().catch(() => null) as Promise<{ connections?: IntegrationConnection[]; error?: string } | null>,
        ]);
        if (!gmailResponse.ok || !gmailResult || !("connections" in gmailResult)) {
          throw new Error(gmailResult?.error ?? "Could not load Gmail connections");
        }
        if (!vercelResponse.ok || !vercelResult || !("connections" in vercelResult)) {
          throw new Error(vercelResult?.error ?? "Could not load Vercel connections");
        }
        if (!notionResponse.ok || !notionResult || !("connections" in notionResult)) {
          throw new Error(notionResult?.error ?? "Could not load Notion connections");
        }
        if (!integrationResponse.ok || !integrationResult || !("connections" in integrationResult)) throw new Error(integrationResult?.error ?? "Could not load integrations");
        if (active) {
          setGmailConnections(gmailResult.connections ?? []);
          setVercelConnections(vercelResult.connections ?? []);
          setNotionConnections(notionResult.connections ?? []);
          setIntegrationConnections(integrationResult.connections ?? []);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load connections");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadConnections();
    return () => { active = false; };
  }, []);

  async function disconnectGmail(id: string) {
    setDisconnectingId(id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/connections/gmail/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; warning?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not disconnect Gmail");
      setGmailConnections((current) => current.filter((connection) => connection.id !== id));
      if (result?.warning) setError(result.warning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Gmail");
    } finally {
      setDisconnectingId(null);
    }
  }

  async function disconnectVercel(id: string) {
    setDisconnectingId(id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/connections/vercel/${id}`, { method: "DELETE", credentials: "include" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not disconnect Vercel");
      setVercelConnections((current) => current.filter((connection) => connection.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Vercel");
    } finally {
      setDisconnectingId(null);
    }
  }

  async function disconnectNotion(id: string) {
    setDisconnectingId(id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/connections/notion/${id}`, { method: "DELETE", credentials: "include" });
      const result = await response.json().catch(() => null) as { error?: string; warning?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not disconnect Notion");
      setNotionConnections((current) => current.filter((connection) => connection.id !== id));
      if (result?.warning) setError(result.warning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Notion");
    } finally {
      setDisconnectingId(null);
    }
  }

  async function disconnectIntegration(id: string) {
    setDisconnectingId(id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/connections/integrations/${id}`, { method: "DELETE", credentials: "include" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not disconnect integration");
      setIntegrationConnections((current) => current.filter((connection) => connection.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect integration");
    } finally {
      setDisconnectingId(null);
    }
  }

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

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2" aria-label="Connection filters">
        {(["all", "connected", "unconnected"] as const).map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={connectionFilter === filter ? "secondary" : "outline"}
            aria-pressed={connectionFilter === filter}
            onClick={() => setConnectionFilter(filter)}
          >
            {filter[0]!.toUpperCase() + filter.slice(1)}
          </Button>
        ))}
      </div>

      {visibleConnections.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleConnections.flatMap((connection) => {
            if (connection.name === "Vercel") {
              const vercelCards = vercelConnections.map((vercel) => (
                <ConnectionCard
                  key={vercel.id}
                  {...connection}
                  status={vercel.status}
                  detail={`${vercel.name} · ${vercel.projects.length} project${vercel.projects.length === 1 ? "" : "s"}`}
                  busy={loading || disconnectingId === vercel.id}
                  connectHref={vercel.status === "needs_reconnect" ? `${apiUrl}/connections/vercel/start` : undefined}
                  onDisconnect={() => void disconnectVercel(vercel.id)}
                />
              ));
              return [
                ...vercelCards,
                ...(connectionFilter !== "connected" ? [
                  <ConnectionCard key="vercel-add" {...connection} status="disconnected" detail={vercelConnections.length ? "Add another Vercel account" : undefined} busy={loading} connectHref={loading ? undefined : `${apiUrl}/connections/vercel/start`} />,
                ] : []),
              ];
            }
            if (connection.name === "Notion") {
              const notionCards = notionConnections.map((notion) => (
                <ConnectionCard
                  key={notion.id}
                  {...connection}
                  status={notion.status}
                  detail={`${notion.name} · ${notion.pages.length} shared page${notion.pages.length === 1 ? "" : "s"}`}
                  busy={loading || disconnectingId === notion.id}
                  connectHref={notion.status === "needs_reconnect" ? `${apiUrl}/connections/notion/start` : undefined}
                  onDisconnect={() => void disconnectNotion(notion.id)}
                />
              ));
              return [
                ...notionCards,
                ...(connectionFilter !== "connected" ? [
                  <ConnectionCard key="notion-add" {...connection} status="disconnected" detail={notionConnections.length ? "Add another Notion workspace" : undefined} busy={loading} connectHref={loading ? undefined : `${apiUrl}/connections/notion/start`} />,
                ] : []),
              ];
            }
            const integrationProvider = (Object.entries(integrationNames).find(([, name]) => name === connection.name)?.[0] ?? null) as IntegrationProvider | null;
            if (integrationProvider) {
              const connected = integrationConnections.find((item) => item.provider === integrationProvider);
              if (connected) return <ConnectionCard key={connected.id} {...connection} status={connected.status} detail={connected.label} busy={loading || disconnectingId === connected.id} connectHref={integrationProvider === "google_calendar" && connected.status === "needs_reconnect" ? `${apiUrl}/connections/google-calendar/start` : undefined} onDisconnect={() => void disconnectIntegration(connected.id)} />;
              return <ConnectionCard key={connection.name} {...connection} status="disconnected" busy={loading} connectHref={integrationProvider === "google_calendar" ? `${apiUrl}/connections/google-calendar/start` : undefined} onConnect={integrationProvider === "google_calendar" ? undefined : () => setSetupProvider(integrationProvider)} />;
            }
            if (connection.name !== "Gmail") return <ConnectionCard key={connection.name} {...connection} />;
            const gmailCards = gmailConnections.filter((gmail) => connectionFilter === "all" || (connectionFilter === "connected" ? gmail.status === "connected" : gmail.status !== "connected")).map((gmail) => (
              <ConnectionCard
                key={gmail.id}
                {...connection}
                status={gmail.status}
                detail={`Connected account: ${gmail.email}`}
                busy={loading || disconnectingId === gmail.id}
                connectHref={gmail.status === "needs_reconnect" && !loading ? `${apiUrl}/connections/gmail/start` : undefined}
                onDisconnect={() => void disconnectGmail(gmail.id)}
              />
            ));
            return [
              ...gmailCards,
              ...(connectionFilter !== "connected" ? [
                <ConnectionCard
                  key="gmail-add"
                  {...connection}
                  status="disconnected"
                  detail={gmailConnections.length ? "Add another Gmail account" : undefined}
                  busy={loading}
                  connectHref={loading ? undefined : `${apiUrl}/connections/gmail/start`}
                />,
              ] : []),
            ];
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No connections match these filters.
        </div>
      )}
      <WebhookConnectionDialog provider={setupProvider} onClose={() => setSetupProvider(null)} onCreated={(connection) => setIntegrationConnections((current) => [...current.filter((item) => item.provider !== connection.provider), connection])} />
    </div>
  );
}
