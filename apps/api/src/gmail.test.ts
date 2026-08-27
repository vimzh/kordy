import { expect, test } from "bun:test";
import {
  buildGmailOAuthUrl,
  decodePubSubPayload,
  decryptToken,
  emailAddress,
  encryptToken,
  listHistory,
  parsePlainText,
  type GmailMessagePart,
} from "./gmail";

const key = Buffer.alloc(32, 7).toString("base64");
const data = (value: string) => Buffer.from(value).toString("base64url");

test("builds an offline incremental Gmail authorization request", () => {
  const url = new URL(buildGmailOAuthUrl({ clientId: "client", redirectUri: "https://example.test/callback", state: "state" }));
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  expect(url.searchParams.get("prompt")).toBe("select_account consent");
  expect(url.searchParams.has("login_hint")).toBe(false);
  expect(url.searchParams.get("scope")?.split(" ")).toEqual([
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ]);
});

test("encrypts and authenticates tokens", () => {
  const encrypted = encryptToken("refresh-token", key);
  expect(encrypted).not.toContain("refresh-token");
  expect(decryptToken(encrypted, key)).toBe("refresh-token");
  const tampered = encrypted.split(".");
  tampered[2] = `${tampered[2]![0] === "A" ? "B" : "A"}${tampered[2]!.slice(1)}`;
  expect(() => decryptToken(tampered.join("."), key)).toThrow();
});

test("rejects malformed Pub/Sub payloads", () => {
  expect(() => decodePubSubPayload({ message: { data: "%%%", messageId: "1" } })).toThrow("Invalid Pub/Sub payload");
  expect(() => decodePubSubPayload({ message: { data: Buffer.from("{}").toString("base64"), messageId: "1" } })).toThrow("Invalid Pub/Sub payload");
  expect(decodePubSubPayload({
    message: { data: Buffer.from(JSON.stringify({ emailAddress: "me@example.com", historyId: "42" })).toString("base64"), messageId: "pub-1" },
  })).toEqual({ messageId: "pub-1", emailAddress: "me@example.com", historyId: "42" });
});

test("recursively reads plain text while ignoring attachments and enforcing the byte cap", () => {
  const payload: GmailMessagePart = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: data("hello ") } },
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/html", body: { data: data("<b>ignored</b>") } },
        { mimeType: "text/plain", body: { data: data("world") } },
      ] },
      { mimeType: "text/plain", filename: "note.txt", body: { data: data("attachment") } },
      { mimeType: "text/plain", body: { attachmentId: "remote", data: data("attachment") } },
    ],
  };
  expect(parsePlainText(payload)).toBe("hello world");
  expect(parsePlainText(payload, 8)).toBe("hello wo");
});

test("accepts Gmail's optional base64url padding", () => {
  expect(parsePlainText({ mimeType: "text/plain", body: { data: Buffer.from("unrelated content").toString("base64") } })).toBe("unrelated content");
});

test("extracts the reply recipient without speaking or guessing an address", () => {
  expect(emailAddress("Alice Example <alice@example.com>")).toBe("alice@example.com");
  expect(emailAddress("invalid sender")).toBeNull();
});

test("paginates history and de-duplicates added messages", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    return url.includes("pageToken=next")
      ? Response.json({ history: [{ messagesAdded: [{ message: { id: "two" } }] }], historyId: "12" })
      : Response.json({ history: [{ messagesAdded: [{ message: { id: "one" } }, { message: { id: "two" } }] }], nextPageToken: "next", historyId: "11" });
  }) as typeof fetch;

  try {
    expect(await listHistory("access-token", "10")).toEqual({ messageIds: ["one", "two"], historyId: "12" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(requests).toHaveLength(2);
});

test("stops runaway Gmail history pagination after ten pages", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (_input) => {
    requests += 1;
    return Response.json({ nextPageToken: `page-${requests}`, historyId: String(requests) });
  }) as typeof fetch;
  try {
    await expect(listHistory("access-token", "10")).rejects.toThrow("10-page safety bound");
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(requests).toBe(10);
});

test("stops Gmail history before fetching more than five hundred messages", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (_input) => {
    requests += 1;
    return Response.json({
      history: [{ messagesAdded: Array.from({ length: 500 }, (_, index) => ({ message: { id: `message-${index}` } })) }],
      nextPageToken: "more",
      historyId: "11",
    });
  }) as typeof fetch;
  try {
    await expect(listHistory("access-token", "10")).rejects.toThrow("500-message safety bound");
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(requests).toBe(1);
});
