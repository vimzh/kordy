"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Database, Paperclip, Settings2, UserRound, X } from "lucide-react";

import type { Contact } from "@/components/ContactsTable";
import { Button } from "@/components/ui/button";

const sources = ["Gmail", "Slack", "GitHub", "Google Calendar", "Vercel", "PostgreSQL"];
const examples = [
  "Call me when @Aarav emails me on Gmail",
  "Call me when production goes down",
  "Call @Maya when a deployment fails",
];
const utilityButtonClass = "w-32";

export type FlowDraft = {
  trigger: string;
  sources: string[];
};

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
  onCreate,
}: {
  contacts: Contact[];
  onCreate: (draft: FlowDraft) => void;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [retryMissedCalls, setRetryMissedCalls] = useState(true);
  const [confirmBeforeCalling, setConfirmBeforeCalling] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const placeholder = useAnimatedPlaceholder();
  const mention = value.match(/(?:^|\s)@([^\s@]*)$/);
  const suggestions = mention
    ? contacts.filter((contact) => contact.name.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 5)
    : [];

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trigger = value.trim();
    if (!trigger) return;

    onCreate({ trigger, sources: selectedSources });
    setValue("");
    inputRef.current?.replaceChildren();
    setSelectedSources([]);
    setAttachments([]);
    if (attachmentRef.current) attachmentRef.current.value = "";
  }

  return (
    <form onSubmit={submit} className="relative w-full rounded-xl border bg-card p-3 shadow-xs">
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

      {attachments.length ? (
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

      <div className="flex flex-wrap items-center gap-2">
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
              <label key={source} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selectedSources.includes(source)}
                  onChange={() => toggleSource(source)}
                  className="size-4 accent-primary"
                />
                {source}
              </label>
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

        <Button className="ml-auto" type="submit" size="lg" disabled={!value.trim()}>
          Create flow
        </Button>
      </div>
    </form>
  );
}
