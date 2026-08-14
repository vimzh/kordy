import { describe, expect, test } from "bun:test";
import { buildNotionOAuthUrl } from "./notion";

describe("Notion connection", () => {
  test("builds a CSRF-bound OAuth URL", () => {
    const url = new URL(buildNotionOAuthUrl({ clientId: "client", redirectUri: "http://localhost:3007/connections/notion/callback", state: "state" }));
    expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ owner: "user", client_id: "client", redirect_uri: "http://localhost:3007/connections/notion/callback", response_type: "code", state: "state" });
  });
});
