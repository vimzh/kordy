import { describe, expect, test } from "bun:test";
import { buildNotionOAuthUrl, getNotionPageContent, matchesNotionPage } from "./notion";

describe("Notion connection", () => {
  test("builds a CSRF-bound OAuth URL", () => {
    const url = new URL(buildNotionOAuthUrl({ clientId: "client", redirectUri: "http://localhost:3007/connections/notion/callback", state: "state" }));
    expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ owner: "user", client_id: "client", redirect_uri: "http://localhost:3007/connections/notion/callback", response_type: "code", state: "state" });
  });

  test("caps recursive page retrieval at one hundred requests", async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async (_input) => {
      requests += 1;
      return Response.json({ results: [], has_more: true, next_cursor: `cursor-${requests}` });
    }) as typeof fetch;
    try {
      await expect(getNotionPageContent("token", { id: "page", title: "Page", url: "", lastEditedTime: "2026-08-26T00:00:00Z" })).rejects.toThrow("100-request safety bound");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests).toBe(100);
  });

  test("filters page summaries before downloading full page content", () => {
    const page = { id: "page-1", title: "Incident Runbook" };
    expect(matchesNotionPage(page, { pageIds: ["page-1"], pageTitles: [] })).toBe(true);
    expect(matchesNotionPage(page, { pageIds: [], pageTitles: ["incident runbook"] })).toBe(true);
    expect(matchesNotionPage(page, { pageIds: ["page-2"], pageTitles: ["Roadmap"] })).toBe(false);
  });
});
