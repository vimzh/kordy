// Notion OAuth and bounded page retrieval for connected workspaces.
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

export class NotionApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "NotionApiError";
  }
}

function basicAuth(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function notionRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new NotionApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export function buildNotionOAuthUrl(input: { clientId: string; redirectUri: string; state: string }) {
  return `https://api.notion.com/v1/oauth/authorize?${new URLSearchParams({
    owner: "user",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
  })}`;
}

async function tokenRequest(input: { clientId: string; clientSecret: string; body: Record<string, string> }) {
  const response = await fetch(`${NOTION_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(input.clientId, input.clientSecret),
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(input.body),
  });
  if (!response.ok) throw new NotionApiError(response.status, await response.text());
  return response.json() as Promise<{
    access_token: string;
    refresh_token: string | null;
    workspace_id: string;
    workspace_name: string | null;
    workspace_icon: string | null;
    bot_id: string;
  }>;
}

export function exchangeNotionCode(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }) {
  return tokenRequest({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    body: { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri },
  });
}

export function refreshNotionToken(input: { refreshToken: string; clientId: string; clientSecret: string }) {
  return tokenRequest({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    body: { grant_type: "refresh_token", refresh_token: input.refreshToken },
  });
}

export type NotionPage = { id: string; title: string; url: string; lastEditedTime: string };

export function matchesNotionPage(page: Pick<NotionPage, "id" | "title">, rule: { pageIds: string[]; pageTitles: string[] }) {
  return (!rule.pageIds.length && !rule.pageTitles.length)
    || rule.pageIds.includes(page.id)
    || rule.pageTitles.some((title) => title.toLowerCase() === page.title.toLowerCase());
}

function pageTitle(page: { properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> }) {
  const property = Object.values(page.properties ?? {}).find((value) => value.type === "title");
  return property?.title?.map((part) => part.plain_text ?? "").join("").trim() || "Untitled";
}

export async function listNotionPages(accessToken: string) {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;
  do {
    const result = await notionRequest<{
      results: Array<{ id: string; url: string; last_edited_time: string; properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> }>;
      has_more: boolean;
      next_cursor: string | null;
    }>("/search", accessToken, {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });
    pages.push(...result.results.map((page) => ({ id: page.id, title: pageTitle(page), url: page.url, lastEditedTime: page.last_edited_time })));
    startCursor = result.has_more && result.next_cursor ? result.next_cursor : undefined;
  } while (startCursor && pages.length < 1_000);
  return pages;
}

function richText(block: { type?: string; [key: string]: unknown }) {
  const value = block.type ? block[block.type] as { rich_text?: Array<{ plain_text?: string }> } | undefined : undefined;
  return value?.rich_text?.map((part) => part.plain_text ?? "").join("").trim() ?? "";
}

export async function getNotionPageContent(accessToken: string, page: NotionPage) {
  const lines: string[] = [];
  const queue = [page.id];
  let requests = 0;
  while (queue.length && lines.join("\n").length < 64_000) {
    const blockId = queue.shift()!;
    let cursor: string | undefined;
    do {
      if (requests++ >= 100) throw new Error("Notion page traversal exceeded the 100-request safety bound");
      const result = await notionRequest<{
        results: Array<{ id: string; type?: string; has_children?: boolean; [key: string]: unknown }>;
        has_more: boolean;
        next_cursor: string | null;
      }>(`/blocks/${encodeURIComponent(blockId)}/children?${new URLSearchParams({ page_size: "100", ...(cursor ? { start_cursor: cursor } : {}) })}`, accessToken);
      for (const block of result.results) {
        const text = richText(block);
        if (text) lines.push(text);
        if (block.has_children && queue.length < 100) queue.push(block.id);
      }
      cursor = result.has_more && result.next_cursor ? result.next_cursor : undefined;
    } while (cursor && lines.join("\n").length < 64_000);
  }
  return { ...page, content: lines.join("\n").slice(0, 64_000) };
}

export async function revokeNotionToken(accessToken: string, clientId: string, clientSecret: string) {
  const response = await fetch(`${NOTION_API}/oauth/revoke`, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify({ token: accessToken }),
  });
  if (!response.ok) throw new NotionApiError(response.status, await response.text());
}
