"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Database, Paperclip, Settings2, UserRound, X } from "lucide-react";

import type { Contact } from "@/components/ContactsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sources = ["Gmail", "Slack", "GitHub", "Google Calendar", "Vercel", "PostgreSQL"];
const examples = [
  "Call me when @Aarav emails me on Gmail",
  "Call me when production goes down",
  "Call @Maya when a deployment fails",
];
const utilityButtonClass = "w-32";

export type Task = {
  id: string;
  originalPrompt: string;
  gmailConnectionId?: string | null;
  status: "creating" | "parsing" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed";
  trigger: {
    type: "email.received";
    match: "and";
    senders: string[];
    subjectKeywords: string[];
    bodyKeywords: string[];
    labels: string[];
  } | null;
  action: {
    type: "calle.call";
    targetType: "self" | "contact";
    targetId?: string;
    targetName: string;
    phone: string;
  } | null;
  clarificationQuestion?: string | null;
  createdAt: string;
  updatedAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
type GmailConnection = { id: string; email: string; status: "connected" | "needs_reconnect" | "disconnected" };

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
  const [attachments, setAttachments] = useState<File[]>([]);
  const [retryMissedCalls, setRetryMissedCalls] = useState(true);
  const [confirmBeforeCalling, setConfirmBeforeCalling] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [clarification, setClarification] = useState<{ taskId: string; question: string } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const inputRef = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const requestInFlight = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const placeholder = useAnimatedPlaceholder();
  const mention = value.match(/(?:^|\s)@([^\s@]*)$/);
  const suggestions = mention
    ? contacts.filter((contact) => contact.name.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 5)
    : [];

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/connections/gmail`, { credentials: "include" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) as { connections?: GmailConnection[] } | null }))
      .then(({ response, body }) => {
        if (!active || !response.ok) return;
        const connected = (body?.connections ?? []).filter((connection) => connection.status === "connected");
        setGmailConnections(connected);
        if (connected.length === 1) setSelectedGmailConnectionId(connected[0]!.id);
      })
      .catch(() => {
        if (active) setError("Could not load Gmail accounts.");
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
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
  }

  function resetComposer() {
    setValue("");
    inputRef.current?.replaceChildren();
    setSelectedSources([]);
    setSelectedGmailConnectionId(gmailConnections.length === 1 ? gmailConnections[0]!.id : "");
    setAttachments([]);
    setClarification(null);
    setClarificationAnswer("");
    requestIds.current.clear();
    if (attachmentRef.current) attachmentRef.current.value = "";
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
        : `create:${prompt}:${selectedSources.join(",")}:${selectedGmailConnectionId}`;
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
              : { requestId, prompt, selectedSources, gmailConnectionId: selectedGmailConnectionId || undefined },
          ),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | Task
        | { status?: string; task?: Task; taskId?: string; question?: string; error?: string; connection?: string; connections?: GmailConnection[] }
        | null;

      if (response.status === 409 && result && "status" in result && result.status === "connection_required" && result.connection === "gmail") {
        window.open(`${apiUrl}/connections/gmail/start`, "_self");
        return;
      }
      if (response.status === 409 && result && "status" in result && result.status === "connection_selection_required") {
        setGmailConnections(result.connections ?? []);
        setError("Choose the Gmail account this flow should watch under Sources.");
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

      const task = "task" in result ? result.task : result;
      if (!task || !("id" in task)) throw new Error("The task API returned an invalid response");
      onCreated?.(task);
      resetComposer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the trigger");
    } finally {
      requestInFlight.current = false;
      setParsing(false);
    }
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
          className="flex h-14 items-center overflow-x-auto whitespace-nowrap px-2 text-base outline-none"
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

      {!clarification && attachments.length ? (
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="flex max-w-52 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
              <Paperclip className="size-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {error ? <p role="alert" className="px-2 py-2 text-sm text-destructive">{error}</p> : null}

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
                {source === "Gmail" && selectedSources.includes("Gmail") && gmailConnections.length > 1 ? (
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
              </div>
            ))}
          </div>
        </details>

        <input
          ref={attachmentRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => setAttachments(Array.from(event.target.files ?? []))}
        />
        <Button
          className={utilityButtonClass}
          type="button"
          variant="ghost"
          size="lg"
          onClick={() => attachmentRef.current?.click()}
        >
          <Paperclip className="size-4" />
          Attach
        </Button>

        <details className="relative">
          <Button asChild type="button" variant="ghost" size="lg" className={`${utilityButtonClass} list-none [&::-webkit-details-marker]:hidden`}>
            <summary>
              <Settings2 className="size-4" />
              Settings
            </summary>
          </Button>
          <div className="absolute top-10 right-0 z-20 w-64 max-w-[calc(100vw-3rem)] rounded-lg border bg-popover p-2 shadow-lg sm:right-auto sm:left-0">
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={retryMissedCalls}
                onChange={(event) => setRetryMissedCalls(event.target.checked)}
                className="size-4 accent-primary"
              />
              Retry unanswered calls
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <input
                type="checkbox"
                checked={confirmBeforeCalling}
                onChange={(event) => setConfirmBeforeCalling(event.target.checked)}
                className="size-4 accent-primary"
              />
              Confirm before calling
            </label>
          </div>
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
