"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Database, RefreshCw, Settings2, UserRound, X } from "lucide-react";

import type { Contact } from "@/components/ContactsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TriggerPlanEditor } from "@/components/triggers/TriggerPlanEditor";

const sources = ["Gmail", "Notion", "Vercel", "GitHub", "Stripe", "Google Calendar", "n8n", "Weather", "SEC", "USGS", "NASA EONET", "Foreign Exchange", "Indian stocks (EOD)"];
const examples = [
  "Call me when rain is forecast in Bengaluru",
  "Call me when Apple files an 8-K",
  "Call me when RELIANCE on NSE closes above ₹1,500",
];
const sourceExamples: Record<string, string[]> = {
  Gmail: ["Call me when invoices from Acme arrive", "Call Priya when a support escalation email arrives"],
  Vercel: ["Call me when production deployment fails", "Call DevOps when checkout preview fails"],
  Notion: ["Call me when the launch plan changes", "Call Alex when the incident page mentions blocked"],
  GitHub: ["Call me when a production issue is opened", "Call me when the release workflow fails"],
  Stripe: ["Call me when a payment fails", "Call finance when a dispute is created"],
  "Google Calendar": ["Call me 10 minutes before the board meeting", "Call me when an urgent meeting is added"],
  n8n: ["Call me when the n8n alert webhook fires", "Call support when the escalation workflow completes"],
  Weather: ["Call me when rain is forecast in Bengaluru"],
  SEC: ["Call me when Apple files an 8-K"],
  USGS: ["Call me after a magnitude 6 earthquake near Tokyo"],
  "NASA EONET": ["Call me when a wildfire event opens in California"],
  "Foreign Exchange": ["Call me when USD/INR rises above 90"],
  "Indian stocks (EOD)": ["Call me when RELIANCE on NSE closes above ₹1,500"],
};
const utilityButtonClass = "w-32";

export type Task = {
  id: string;
  name: string;
  originalPrompt: string;
  gmailConnectionId?: string | null;
  vercelConnectionId?: string | null;
  notionConnectionId?: string | null;
  integrationConnectionId?: string | null;
  connection?: { id: string; provider: string; label: string; status: string } | null;
  status: "creating" | "parsing" | "draft" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed";
  trigger: {
    type: "email.received";
    match: "and";
    senders: string[];
    subjectKeywords: string[];
    bodyKeywords: string[];
    labels: string[];
  } | {
    type: "deployment.failed";
    projectIds: string[];
    projectNames: string[];
    environments: Array<"production" | "preview">;
  } | {
    type: "notion.page.updated";
    pageIds: string[];
    pageTitles: string[];
    keywords: string[];
  } | {
    type: "integration.event";
    provider: "github" | "stripe" | "google_calendar" | "n8n";
    eventNames: string[];
    keywords: string[];
    withinMinutes: number;
  } | {
    type: "weather.rain_forecast";
    location: string;
    latitude: number;
    longitude: number;
    minimumPrecipitationMm: number;
    withinHours: number;
    consecutiveHours: number;
  } | {
    type: "sec.filing.published";
    cik: string;
    companyName: string;
    forms: string[];
  } | {
    type: "usgs.earthquake.detected";
    location: string;
    latitude: number;
    longitude: number;
    radiusKm: number;
    minimumMagnitude: number;
  } | {
    type: "nasa.event.opened";
    categories: string[];
    location: string;
    bbox: [number, number, number, number] | [];
  } | {
    type: "fx.rate.threshold";
    base: string;
    quote: string;
    operator: "above" | "below";
    threshold: number;
  } | {
    type: "india.stock.price_threshold";
    symbol: string;
    companyName: string;
    exchange: "NSE" | "BSE";
    operator: "above" | "below";
    price: number;
  } | {
    type: "india.stock.daily_move";
    symbol: string;
    companyName: string;
    exchange: "NSE" | "BSE";
    direction: "gain" | "loss";
    percent: number;
  } | {
    type: "india.stock.volume_threshold";
    symbol: string;
    companyName: string;
    exchange: "NSE" | "BSE";
    minimumVolume: number;
  } | null;
  action: {
    type: "calle.call";
    targetType: "self" | "contact";
    targetId?: string;
    targetName: string;
    phone: string;
    task: string;
  } | null;
  executionMode: "approval" | "automatic";
  parserConfidence?: number | null;
  parserAmbiguity?: string | null;
  delivery?: {
    timezone?: string;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    cooldownMinutes?: number;
    maxCallsPerHour?: number;
    maxCallsPerDay?: number;
    startsAt?: string;
    expiresAt?: string;
    locale?: string;
    region?: string;
  };
  activationAt?: string | null;
  clarificationQuestion?: string | null;
  createdAt: string;
  updatedAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
type GmailConnection = { id: string; email: string; status: "connected" | "needs_reconnect" | "disconnected" };
type VercelConnection = { id: string; name: string; slug: string; status: "connected" | "needs_reconnect" | "disconnected"; projects: Array<{ id: string; name: string }> };
type NotionConnection = { id: string; name: string; status: "connected" | "needs_reconnect" | "disconnected"; pages: Array<{ id: string; title: string }> };
type IntegrationConnection = { id: string; provider: "github" | "stripe" | "google_calendar" | "n8n"; label: string; status: "connected" | "needs_reconnect" | "disconnected" };
type ExecutionMode = "approval" | "automatic";
type FlowDraft = {
  value: string;
  selectedSources: string[];
  selectedGmailConnectionId: string;
  selectedVercelConnectionId: string;
  selectedNotionConnectionId: string;
  selectedIntegrationConnectionId: string;
  executionMode: ExecutionMode;
};

const draftKey = "kyub:flow-draft";

function taskFromResponse(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { task?: unknown; id?: unknown };
  const task = record.task && typeof record.task === "object" ? record.task : record;
  return task && typeof (task as { id?: unknown }).id === "string" ? task as Task : null;
}

function integrationProviderForSource(source: string) {
  return ({ GitHub: "github", Stripe: "stripe", "Google Calendar": "google_calendar", n8n: "n8n" } as const)[source as "GitHub" | "Stripe" | "Google Calendar" | "n8n"];
}

function connectionSetup(connection: string | undefined) {
  const names: Record<string, string> = {
    gmail: "Gmail",
    vercel: "Vercel",
    notion: "Notion",
    google_calendar: "Google Calendar",
    github: "GitHub",
    stripe: "Stripe",
    n8n: "n8n",
  };
  const name = connection ? names[connection] ?? "source" : "source";
  const path = connection === "google_calendar" ? "google-calendar" : connection;
  const oauthProvider = path === "gmail" || path === "vercel" || path === "notion" || path === "google-calendar";
  return {
    name,
    href: oauthProvider
      ? `${apiUrl}/connections/${path}/start?returnTo=${encodeURIComponent("/home?resume=1")}`
      : "/connections",
  };
}

function useAnimatedPlaceholder() {
  const [animation, setAnimation] = useState({ text: "", index: 0, deleting: false });

  useEffect(() => {
    const phrase = examples[animation.index];
    const delay = animation.text === phrase ? 1800 : animation.deleting ? 20 : 35;
    const timeout = setTimeout(() => {
      setAnimation((current) => {
        const currentPhrase = examples[current.index];
        if (!current.deleting && current.text === currentPhrase) return { ...current, deleting: true };
        if (current.deleting && current.text === "") {
          return { text: "", index: (current.index + 1) % examples.length, deleting: false };
        }
        return {
          ...current,
          text: current.deleting
            ? current.text.slice(0, -1)
            : currentPhrase.slice(0, current.text.length + 1),
        };
      });
    }, delay);
    return () => clearTimeout(timeout);
  }, [animation]);

  return animation.text;
}

function insertMention(root: HTMLDivElement, start: number, end: number, name: string) {
  const locate = (offset: number) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let traversed = 0;
    let node = walker.nextNode();

    while (node) {
      const length = node.textContent?.length ?? 0;
      if (offset <= traversed + length) return { node, offset: offset - traversed };
      traversed += length;
      node = walker.nextNode();
    }

    return { node: root, offset: root.childNodes.length };
  };

  const from = locate(start);
  const to = locate(end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  range.deleteContents();

  const pill = document.createElement("span");
  pill.className = "flow-mention";
  pill.contentEditable = "false";
  pill.textContent = `@${name}`;
  range.insertNode(pill);

  const trailingSpace = document.createTextNode("\u00a0");
  pill.after(trailingSpace);
  range.setStart(trailingSpace, 1);
  range.collapse(true);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function FlowComposer({
  contacts,
  onCreated,
}: {
  contacts: Contact[];
  onCreated?: (task: Task) => void;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [gmailConnections, setGmailConnections] = useState<GmailConnection[]>([]);
  const [selectedGmailConnectionId, setSelectedGmailConnectionId] = useState("");
  const [vercelConnections, setVercelConnections] = useState<VercelConnection[]>([]);
  const [selectedVercelConnectionId, setSelectedVercelConnectionId] = useState("");
  const [notionConnections, setNotionConnections] = useState<NotionConnection[]>([]);
  const [selectedNotionConnectionId, setSelectedNotionConnectionId] = useState("");
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [selectedIntegrationConnectionId, setSelectedIntegrationConnectionId] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("approval");
  const [automaticReady, setAutomaticReady] = useState(false);
  const [connectionGuidance, setConnectionGuidance] = useState<{ name: string; href: string } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [clarification, setClarification] = useState<{ taskId: string; question: string } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [previewTask, setPreviewTask] = useState<Task | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const inputRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const restoredDraft = useRef(false);
  const placeholder = useAnimatedPlaceholder();
  const mention = value.match(/(?:^|\s)@([^\s@]*)$/);
  const suggestions = mention
    ? contacts.filter((contact) => contact.name.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 5)
    : [];

  useEffect(() => {
    const stored = localStorage.getItem(draftKey) ?? sessionStorage.getItem(draftKey);
    if (!stored) {
      if (new URLSearchParams(window.location.search).get("resume") === "1") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      return;
    }
    let draft: Partial<FlowDraft>;
    try {
      draft = JSON.parse(stored) as Partial<FlowDraft>;
      if (typeof draft.value !== "string" || !Array.isArray(draft.selectedSources)) throw new Error("Invalid draft");
    } catch {
      localStorage.removeItem(draftKey);
      sessionStorage.removeItem(draftKey);
      return;
    }
    const draftValue = draft.value;
    const draftSources = draft.selectedSources;
    const frame = window.requestAnimationFrame(() => {
      setValue(draftValue);
      inputRef.current?.replaceChildren(draftValue);
      setSelectedSources(draftSources.filter((source): source is string => typeof source === "string"));
      setSelectedGmailConnectionId(draft.selectedGmailConnectionId ?? "");
      setSelectedVercelConnectionId(draft.selectedVercelConnectionId ?? "");
      setSelectedNotionConnectionId(draft.selectedNotionConnectionId ?? "");
      setSelectedIntegrationConnectionId(draft.selectedIntegrationConnectionId ?? "");
      setExecutionMode(draft.executionMode === "automatic" ? "automatic" : "approval");
      restoredDraft.current = true;
      window.dispatchEvent(new Event("kyub:onboarding-updated"));
    });
    if (new URLSearchParams(window.location.search).get("resume") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!restoredDraft.current && !value && !selectedSources.length) return;
    const draft: FlowDraft = {
      value,
      selectedSources,
      selectedGmailConnectionId,
      selectedVercelConnectionId,
      selectedNotionConnectionId,
      selectedIntegrationConnectionId,
      executionMode,
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [executionMode, selectedGmailConnectionId, selectedIntegrationConnectionId, selectedNotionConnectionId, selectedSources, selectedVercelConnectionId, value]);

  useEffect(() => {
    let active = true;
    async function loadReadiness() {
      const response = await fetch(`${apiUrl}/onboarding`, { credentials: "include" });
      const result = await response.json().catch(() => null) as { profile?: { readyForAutomaticCalls?: boolean } } | null;
      if (!active || !response.ok) return;
      const ready = result?.profile?.readyForAutomaticCalls === true;
      setAutomaticReady(ready);
      setExecutionMode((current) => ready ? (restoredDraft.current ? current : "automatic") : "approval");
    }
    void loadReadiness().catch(() => undefined);
    const refresh = () => void loadReadiness().catch(() => undefined);
    window.addEventListener("kyub:onboarding-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("kyub:onboarding-updated", refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`${apiUrl}/connections/gmail`, { credentials: "include" }),
      fetch(`${apiUrl}/connections/vercel`, { credentials: "include" }),
      fetch(`${apiUrl}/connections/notion`, { credentials: "include" }),
      fetch(`${apiUrl}/connections/integrations`, { credentials: "include" }),
    ]).then(async ([gmailResponse, vercelResponse, notionResponse, integrationResponse]) => ({
      gmailResponse,
      vercelResponse,
      notionResponse,
      gmailBody: await gmailResponse.json().catch(() => null) as { connections?: GmailConnection[] } | null,
      vercelBody: await vercelResponse.json().catch(() => null) as { connections?: VercelConnection[] } | null,
      notionBody: await notionResponse.json().catch(() => null) as { connections?: NotionConnection[] } | null,
      integrationResponse,
      integrationBody: await integrationResponse.json().catch(() => null) as { connections?: IntegrationConnection[] } | null,
    })).then(({ gmailResponse, vercelResponse, notionResponse, integrationResponse, gmailBody, vercelBody, notionBody, integrationBody }) => {
        if (!active) return;
        const gmail = gmailResponse.ok ? (gmailBody?.connections ?? []).filter((connection) => connection.status === "connected") : [];
        const vercel = vercelResponse.ok ? (vercelBody?.connections ?? []).filter((connection) => connection.status === "connected") : [];
        const notion = notionResponse.ok ? (notionBody?.connections ?? []).filter((connection) => connection.status === "connected") : [];
        const integrations = integrationResponse.ok ? (integrationBody?.connections ?? []).filter((connection) => connection.status === "connected") : [];
        setGmailConnections(gmail);
        setVercelConnections(vercel);
        setNotionConnections(notion);
        setIntegrationConnections(integrations);
        if (gmail.length === 1) setSelectedGmailConnectionId(gmail[0]!.id);
        if (vercel.length === 1) setSelectedVercelConnectionId(vercel[0]!.id);
        if (notion.length === 1) setSelectedNotionConnectionId(notion[0]!.id);
        if (integrations.length === 1) setSelectedIntegrationConnectionId(integrations[0]!.id);
      })
      .catch(() => {
        if (active) setError("Could not load connected source accounts.");
      });
    return () => { active = false; };
  }, []);

  function selectContact(contact: Contact) {
    const input = inputRef.current;
    const mentionStart = value.lastIndexOf("@");
    if (!input || mentionStart < 0) return;

    input.focus();
    insertMention(input, mentionStart, value.length, contact.name);
    setValue((input.textContent ?? "").replaceAll("\u00a0", " "));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && suggestions[0]) {
      event.preventDefault();
      selectContact(suggestions[0]);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
    }
  }

  function toggleSource(source: string) {
    setSelectedSources((current) => current.includes(source) ? [] : [source]);
    const provider = integrationProviderForSource(source);
    const connections = provider ? integrationConnections.filter((connection) => connection.provider === provider) : [];
    if (connections.length === 1) setSelectedIntegrationConnectionId(connections[0]!.id);
  }

  function saveDraft() {
    const draft: FlowDraft = {
      value,
      selectedSources,
      selectedGmailConnectionId,
      selectedVercelConnectionId,
      selectedNotionConnectionId,
      selectedIntegrationConnectionId,
      executionMode,
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }

  function resetComposer() {
    setValue("");
    inputRef.current?.replaceChildren();
    setSelectedSources([]);
    setSelectedGmailConnectionId(gmailConnections.length === 1 ? gmailConnections[0]!.id : "");
    setSelectedVercelConnectionId(vercelConnections.length === 1 ? vercelConnections[0]!.id : "");
    setSelectedNotionConnectionId(notionConnections.length === 1 ? notionConnections[0]!.id : "");
    setSelectedIntegrationConnectionId(integrationConnections.length === 1 ? integrationConnections[0]!.id : "");
    setClarification(null);
    setClarificationAnswer("");
    setConnectionGuidance(null);
    setPreviewTask(null);
    setTestResult("");
    requestIds.current.clear();
    localStorage.removeItem(draftKey);
    sessionStorage.removeItem(draftKey);
  }

  async function pollTask(taskId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(`${apiUrl}/tasks/${taskId}`, { credentials: "include" });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
      if (!response.ok) throw new Error(result && "error" in result ? result.error : "Could not load the parsed trigger");
      const task = taskFromResponse(result);
      if (!task) throw new Error("The task API returned an invalid response");
      if (task.status !== "creating" && task.status !== "parsing") return task;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error("Parsing is taking longer than expected. The draft is saved in Triggers.");
  }

  async function savePreview(status?: Task["status"]) {
    if (!previewTask) return null;
    setParsing(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${previewTask.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: previewTask.name,
          trigger: previewTask.trigger,
          action: previewTask.action,
          executionMode: previewTask.executionMode,
          delivery: previewTask.delivery ?? {},
        }),
      });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
      if (!response.ok) throw new Error(result && "error" in result ? result.error : "Could not save the trigger");
      let task = taskFromResponse(result);
      if (!task) throw new Error("The task API returned an invalid response");
      if (status) {
        const statusResponse = await fetch(`${apiUrl}/tasks/${previewTask.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const statusResult = await statusResponse.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
        if (!statusResponse.ok) throw new Error(statusResult && "error" in statusResult ? statusResult.error : "Could not activate the trigger");
        task = taskFromResponse(statusResult);
        if (!task) throw new Error("The task API returned an invalid response");
      }
      setPreviewTask(task);
      return task;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the trigger");
      return null;
    } finally {
      setParsing(false);
    }
  }

  async function activatePreview() {
    const task = await savePreview("active");
    if (!task) return;
    onCreated?.(task);
    resetComposer();
  }

  async function testPreview() {
    if (!previewTask) return;
    setTesting(true);
    setError("");
    setTestResult("");
    try {
      const saved = await savePreview();
      if (!saved) return;
      const response = await fetch(`${apiUrl}/tasks/${saved.id}/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => null) as { test?: boolean; dispatched?: boolean; preview?: { source?: string; recipient?: string; executionMode?: string }; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not test the trigger");
      setTestResult(result?.dispatched === false
        ? `Sample accepted for ${result.preview?.source ?? "this source"}. No call was placed.`
        : "Synthetic test completed. No call was placed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not test the trigger");
    } finally {
      setTesting(false);
    }
  }

  async function retryParsing(taskId: string) {
    setParsing(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/tasks/${taskId}/retry`, { method: "POST", credentials: "include" });
      const result = await response.json().catch(() => null) as { task?: Task; error?: string } | Task | null;
      if (!response.ok) throw new Error(result && "error" in result ? result.error : "Could not retry parsing");
      const task = taskFromResponse(result);
      if (!task) throw new Error("The task API returned an invalid response");
      setPreviewTask(await pollTask(task.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry parsing");
    } finally {
      setParsing(false);
    }
  }

  async function cancelAndRestart() {
    const taskId = clarification?.taskId ?? previewTask?.id;
    if (taskId) {
      await fetch(`${apiUrl}/tasks/${taskId}/cancel`, { method: "POST", credentials: "include" }).catch(() => undefined);
    }
    resetComposer();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;

    const prompt = value.trim();
    const answer = clarificationAnswer.trim();
    if ((!clarification && !prompt) || (clarification && !answer)) return;

    requestInFlight.current = true;
    setParsing(true);
    setError("");

    try {
      const requestKey = clarification
        ? `clarify:${clarification.taskId}:${answer}`
        : `create:${prompt}:${selectedSources.join(",")}:${selectedGmailConnectionId}:${selectedVercelConnectionId}:${selectedNotionConnectionId}:${selectedIntegrationConnectionId}:${executionMode}`;
      const requestId = requestIds.current.get(requestKey) ?? crypto.randomUUID();
      requestIds.current.set(requestKey, requestId);
      const response = await fetch(
        clarification ? `${apiUrl}/tasks/${clarification.taskId}/clarify` : `${apiUrl}/tasks`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            clarification
              ? { requestId, answer }
              : {
                requestId,
                prompt,
                selectedSources,
                executionMode,
                gmailConnectionId: selectedGmailConnectionId || undefined,
                vercelConnectionId: selectedVercelConnectionId || undefined,
                notionConnectionId: selectedNotionConnectionId || undefined,
                integrationConnectionId: selectedIntegrationConnectionId || undefined,
              },
          ),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | Task
        | { status?: string; task?: Task; taskId?: string; question?: string; error?: string; connection?: string; connections?: Array<GmailConnection | VercelConnection | NotionConnection | IntegrationConnection> }
        | null;

      if (response.status === 409 && result && "status" in result && result.status === "connection_required") {
        saveDraft();
        setConnectionGuidance(connectionSetup(result.connection));
        return;
      }
      if (response.status === 409 && result && "status" in result && result.status === "connection_selection_required") {
        if (result.connection === "vercel") setVercelConnections((result.connections ?? []).filter((item): item is VercelConnection => "slug" in item));
        else if (result.connection === "notion") setNotionConnections((result.connections ?? []).filter((item): item is NotionConnection => "name" in item && "pages" in item));
        else if (result.connection === "gmail") setGmailConnections((result.connections ?? []).filter((item): item is GmailConnection => "email" in item));
        else {
          const provider = result.connection as IntegrationConnection["provider"];
          const connections = (result.connections ?? []).filter((item) => "id" in item && "label" in item).map((item) => ({
            id: item.id,
            provider,
            label: item.label ?? connectionSetup(result.connection).name,
            status: "connected" as const,
          }));
          setIntegrationConnections((current) => [...current.filter((item) => item.provider !== provider), ...connections]);
        }
        setError(`Choose the ${connectionSetup(result.connection).name} account this flow should watch under Sources.`);
        return;
      }
      if (!response.ok || !result) {
        throw new Error(result && "error" in result ? result.error : "Could not create the trigger");
      }

      if ("taskId" in result && result.taskId && result.question) {
        setClarification({ taskId: result.taskId, question: result.question });
        setClarificationAnswer("");
        return;
      }

      const created = taskFromResponse(result);
      if (!created) throw new Error("The task API returned an invalid response");
      const task = created.status === "creating" || created.status === "parsing" ? await pollTask(created.id) : created;
      if (task.status === "needs_clarification") {
        setClarification({ taskId: task.id, question: task.clarificationQuestion ?? "What should Kordy clarify?" });
        setClarificationAnswer("");
        return;
      }
      setPreviewTask(task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the trigger");
    } finally {
      requestInFlight.current = false;
      setParsing(false);
    }
  }

  if (previewTask) {
    if (previewTask.status === "parse_failed") {
      return (
        <div className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">
          <div>
            <h3 className="font-medium">Kordy could not parse this trigger</h3>
            <p className="mt-1 text-sm text-muted-foreground">Your draft is preserved. Retry it or return to the prompt and make the condition more specific.</p>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={parsing} onClick={() => void retryParsing(previewTask.id)}><RefreshCw />{parsing ? "Retrying…" : "Retry parsing"}</Button>
            <Button type="button" variant="outline" onClick={() => void cancelAndRestart()}><X />Revise prompt</Button>
          </div>
        </div>
      );
    }

    return <TriggerPlanEditor task={previewTask} onChange={setPreviewTask} onTest={() => void testPreview()} onCancel={() => void cancelAndRestart()} onActivate={() => void activatePreview()} busy={parsing} testing={testing} testResult={testResult} error={error} />;
  }

  return (
    <form onSubmit={submit} className="relative w-full rounded-xl border bg-card p-3 shadow-xs">
      {clarification ? (
        <div className="space-y-3 px-2 py-1">
          <div>
            <p className="text-sm font-medium">One detail needed</p>
            <p className="mt-1 text-sm text-muted-foreground">{clarification.question}</p>
          </div>
          <Input
            autoFocus
            aria-label="Clarification answer"
            value={clarificationAnswer}
            onChange={(event) => setClarificationAnswer(event.target.value)}
            placeholder="Type your answer"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => void cancelAndRestart()}><X />Cancel and restart</Button>
        </div>
      ) : (
      <div className="relative">
        {!value && !focused ? (
          <span className="pointer-events-none absolute inset-0 flex h-14 items-center px-2 text-base text-muted-foreground">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={inputRef}
          id="new-trigger"
          role="textbox"
          aria-label="Describe the call trigger"
          aria-multiline="false"
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => setValue((event.currentTarget.textContent ?? "").replaceAll("\u00a0", " "))}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex h-14 items-center overflow-x-auto whitespace-nowrap rounded-md px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {suggestions.length ? (
          <div role="listbox" aria-label="Contacts" className="absolute top-full left-2 z-20 mt-1 w-72 rounded-lg border bg-popover p-1 shadow-lg">
            {suggestions.map((contact) => (
              <button
                key={contact.id}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectContact(contact);
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
              >
                <UserRound className="mt-0.5 size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{contact.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{contact.summary}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      )}

      {!clarification && selectedSources.length && sourceExamples[selectedSources[0]!]?.length ? (
        <div className="flex flex-wrap gap-2 px-2 pb-3" aria-label={`${selectedSources[0]} examples`}>
          {sourceExamples[selectedSources[0]!]!.map((example) => (
            <button
              key={example}
              type="button"
              className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setValue(example);
                inputRef.current?.replaceChildren(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p role="alert" className="px-2 py-2 text-sm text-destructive">{error}</p> : null}
      {connectionGuidance ? (
        <div role="status" className="mx-2 mb-3 flex flex-col gap-3 rounded-lg border bg-muted/50 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Connect {connectionGuidance.name} to continue</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Your draft is saved. Return to Home after setup.</p>
          </div>
          <Button asChild type="button" size="sm">
            <a href={connectionGuidance.href}>Connect {connectionGuidance.name}</a>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!clarification ? (
          <>
        <details className="relative">
          <Button asChild type="button" variant="ghost" size="lg" className={`${utilityButtonClass} list-none [&::-webkit-details-marker]:hidden`}>
            <summary>
              <Database className="size-4" />
              Sources{selectedSources.length ? ` (${selectedSources.length})` : ""}
            </summary>
          </Button>
          <div className="absolute top-10 left-0 z-20 w-56 max-w-[calc(100vw-3rem)] rounded-lg border bg-popover p-2 shadow-lg">
            <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Use events from</p>
            {sources.map((source) => (
              <div key={source}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source)}
                    onChange={() => toggleSource(source)}
                    className="size-4 accent-primary"
                  />
                  {source}
                </label>
                {source === "Gmail" && selectedSources.includes("Gmail") && gmailConnections.length > 0 ? (
                  <div className="space-y-1 px-2 pb-2">
                    {gmailConnections.map((connection) => (
                      <label key={connection.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                        <input
                          type="radio"
                          name="gmail-connection"
                          checked={selectedGmailConnectionId === connection.id}
                          onChange={() => setSelectedGmailConnectionId(connection.id)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="truncate">{connection.email}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {source === "Vercel" && selectedSources.includes("Vercel") && vercelConnections.length > 0 ? (
                  <div className="space-y-1 px-2 pb-2">
                    {vercelConnections.map((connection) => (
                      <label key={connection.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                        <input
                          type="radio"
                          name="vercel-connection"
                          checked={selectedVercelConnectionId === connection.id}
                          onChange={() => setSelectedVercelConnectionId(connection.id)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="truncate">{connection.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {source === "Notion" && selectedSources.includes("Notion") && notionConnections.length > 0 ? (
                  <div className="space-y-1 px-2 pb-2">
                    {notionConnections.map((connection) => (
                      <label key={connection.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                        <input
                          type="radio"
                          name="notion-connection"
                          checked={selectedNotionConnectionId === connection.id}
                          onChange={() => setSelectedNotionConnectionId(connection.id)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="truncate">{connection.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {["GitHub", "Stripe", "Google Calendar", "n8n"].includes(source) && selectedSources.includes(source) ? (
                  <div className="space-y-1 px-2 pb-2">
                    {integrationConnections
                      .filter((connection) => integrationProviderForSource(source) === connection.provider)
                      .map((connection) => (
                        <label key={connection.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                          <input
                            type="radio"
                            name="integration-connection"
                            checked={selectedIntegrationConnectionId === connection.id}
                            onChange={() => setSelectedIntegrationConnectionId(connection.id)}
                            className="size-3.5 accent-primary"
                          />
                          <span className="truncate">{connection.label}</span>
                        </label>
                      ))}
                    {!integrationConnections.some((connection) => integrationProviderForSource(source) === connection.provider) ? (
                      <a className="block rounded-md px-2 py-1.5 text-xs text-primary underline underline-offset-2" href={connectionSetup(integrationProviderForSource(source)).href}>
                        Connect {source}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </details>

        <details className="relative">
          <Button asChild type="button" variant="ghost" size="lg" className={`${utilityButtonClass} list-none [&::-webkit-details-marker]:hidden`}>
            <summary>
              <Settings2 className="size-4" />
              {executionMode === "approval" ? "Approval" : "Automatic"}
            </summary>
          </Button>
          <fieldset className="absolute top-10 right-0 z-20 w-72 max-w-[calc(100vw-3rem)] rounded-lg border bg-popover p-2 shadow-lg sm:right-auto sm:left-0">
            <legend className="sr-only">Call behavior</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <input
                type="radio"
                name="execution-mode"
                value="approval"
                checked={executionMode === "approval"}
                onChange={() => setExecutionMode("approval")}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">Approval required</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Review each matched event before Kordy calls.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 rounded-md px-2 py-2 ${automaticReady ? "cursor-pointer hover:bg-muted" : "cursor-not-allowed opacity-60"}`}>
              <input
                type="radio"
                name="execution-mode"
                value="automatic"
                checked={executionMode === "automatic"}
                disabled={!automaticReady}
                onChange={() => setExecutionMode("automatic")}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">Automatic</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {automaticReady ? "Call immediately when the trigger matches." : "Requires consent and a verified call number."}
                </span>
              </span>
            </label>
          </fieldset>
        </details>
          </>
        ) : null}

        <Button
          className="ml-auto"
          type="submit"
          size="lg"
          disabled={parsing || (clarification ? !clarificationAnswer.trim() : !value.trim())}
        >
          {parsing ? "Parsing…" : clarification ? "Continue" : "Create flow"}
        </Button>
      </div>
    </form>
  );
}
