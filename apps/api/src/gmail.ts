// Gmail OAuth, API transport, token protection, and message parsing helpers.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BODY_BYTES = 64 * 1024;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
};

export type ParsedGmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  sender: string;
  subject: string;
  body: string;
  labelIds: string[];
  snippet?: string;
  receivedAt?: string;
};

export type GmailRule = {
  senders?: string[] | null;
  subjectKeywords?: string[] | null;
  bodyKeywords?: string[] | null;
  labels?: string[] | null;
};

export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`Gmail request failed with ${status}`);
    this.name = "GmailApiError";
  }
}

export function buildGmailOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account consent",
    state: input.state,
  }).toString();
  return url.toString();
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new GmailApiError(response.status, await response.text(), retryAfter(response));
  const tokens = (await response.json()) as Partial<GoogleTokens>;
  if (!tokens.access_token || typeof tokens.expires_in !== "number" || !tokens.token_type) {
    throw new Error("Google returned an invalid token response");
  }
  return tokens as GoogleTokens;
}

export function exchangeGmailCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  return tokenRequest(new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  }));
}

export function refreshGmailAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) {
  return tokenRequest(new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
  }));
}

function encryptionKey(value = process.env.TOKEN_ENCRYPTION_KEY) {
  if (!value) throw new Error("Missing TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptToken(token: string, key?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(value: string, key?: string) {
  const [version, ivValue, tagValue, encryptedValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || encryptedValue === undefined || extra !== undefined) {
    throw new Error("Invalid encrypted token");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function retryAfter(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function gmail<T>(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new GmailApiError(response.status, await response.text(), retryAfter(response));
  return response.json() as Promise<T>;
}

export type GmailWatch = { historyId: string; expiration: string };

export function watchInbox(accessToken: string, topicName: string) {
  return gmail<GmailWatch>(accessToken, "/watch", {
    method: "POST",
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  });
}

export function getGmailProfile(accessToken: string) {
  return gmail<{ emailAddress: string; historyId: string }>(accessToken, "/profile");
}

export async function listGmailLabels(accessToken: string) {
  const result = await gmail<{ labels?: { id?: string; name?: string }[] }>(accessToken, "/labels");
  return Object.fromEntries((result.labels ?? []).flatMap((label) => label.id && label.name ? [[label.name, label.id]] : []));
}

export async function listHistory(accessToken: string, startHistoryId: string) {
  const messageIds: string[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  let pages = 0;

  do {
    if (pages++ >= 10) throw new Error("Gmail history exceeded the 10-page safety bound; reconnect to reset the cursor");
    const query = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "500" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await gmail<{
      history?: { messagesAdded?: { message?: { id?: string } }[] }[];
      nextPageToken?: string;
      historyId?: string;
    }>(accessToken, `/history?${query}`);
    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          messageIds.push(id);
        }
      }
    }
    if (messageIds.length >= 500 && page.nextPageToken) throw new Error("Gmail history exceeded the 500-message safety bound; reconnect to reset the cursor");
    pageToken = page.nextPageToken;
    if (page.historyId) historyId = page.historyId;
  } while (pageToken);

  return { messageIds, historyId };
}

export function getMessage(accessToken: string, messageId: string, format: "metadata" | "full" = "full") {
  const query = new URLSearchParams({ format });
  if (format === "metadata") {
    query.append("metadataHeaders", "From");
    query.append("metadataHeaders", "Subject");
  }
  return gmail<GmailMessage>(accessToken, `/messages/${encodeURIComponent(messageId)}?${query}`);
}

function decodeMimeData(value: string) {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.indexOf("=") !== -1 && !/=+$/.test(value) || value.replace(/=+$/, "").length % 4 === 1) {
    throw new Error("Invalid base64url MIME data");
  }
  return Buffer.from(value, "base64url");
}

export function parsePlainText(payload: GmailMessagePart | undefined, maxBytes = MAX_BODY_BYTES) {
  if (!payload || maxBytes < 1) return "";
  const chunks: Buffer[] = [];
  let remaining = maxBytes;

  function visit(part: GmailMessagePart) {
    if (remaining === 0 || part.filename || part.body?.attachmentId) return;
    if (part.mimeType?.toLowerCase() === "text/plain" && part.body?.data) {
      const chunk = decodeMimeData(part.body.data).subarray(0, remaining);
      chunks.push(chunk);
      remaining -= chunk.length;
    }
    for (const child of part.parts ?? []) visit(child);
  }

  visit(payload);
  return Buffer.concat(chunks).toString("utf8");
}

function header(payload: GmailMessagePart | undefined, name: string) {
  return payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function emailAddress(value: string) {
  return value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? value.match(/\b[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\b/)?.[0] ?? null;
}

export async function sendGmailReply(accessToken: string, input: { message: GmailMessage; body: string }) {
  const recipient = emailAddress(header(input.message.payload, "From"));
  if (!recipient || !input.message.threadId) throw new Error("The matched Gmail message cannot be replied to");
  const subject = header(input.message.payload, "Subject");
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject || "Your email"}`;
  const messageId = header(input.message.payload, "Message-Id");
  const lines = [
    `To: ${recipient}`,
    `Subject: ${replySubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
    "",
    input.body.trim(),
  ];
  return gmail<{ id: string }>(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ threadId: input.message.threadId, raw: Buffer.from(lines.join("\r\n")).toString("base64url") }),
  });
}

export function parseGmailMessage(message: GmailMessage): ParsedGmailMessage {
  const receivedAt = message.internalDate && Number.isFinite(Number(message.internalDate)) ? new Date(Number(message.internalDate)).toISOString() : undefined;
  return {
    id: message.id,
    threadId: message.threadId,
    historyId: message.historyId,
    sender: header(message.payload, "From"),
    subject: header(message.payload, "Subject"),
    body: parsePlainText(message.payload),
    labelIds: message.labelIds ?? [],
    snippet: message.snippet,
    receivedAt,
  };
}

function decodePubSubData(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid Pub/Sub payload");
  }
  return Buffer.from(value, "base64").toString("utf8");
}

export function decodePubSubPayload(payload: unknown) {
  try {
    if (!payload || typeof payload !== "object" || !("message" in payload)) throw new Error();
    const message = payload.message;
    if (!message || typeof message !== "object" || !("data" in message) || typeof message.data !== "string") throw new Error();
    const messageId = "messageId" in message && typeof message.messageId === "string"
      ? message.messageId
      : "message_id" in message && typeof message.message_id === "string" ? message.message_id : "";
    const data = JSON.parse(decodePubSubData(message.data)) as unknown;
    if (!messageId || !data || typeof data !== "object" || !("emailAddress" in data) || !("historyId" in data)
      || typeof data.emailAddress !== "string" || !data.emailAddress || typeof data.historyId !== "string" || !data.historyId) throw new Error();
    return { messageId, emailAddress: data.emailAddress, historyId: data.historyId };
  } catch {
    throw new Error("Invalid Pub/Sub payload");
  }
}

export async function verifyPubSubOidc(authHeader: string | undefined): Promise<TokenPayload> {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const serviceAccount = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT;
  if (!audience || !serviceAccount) throw new Error("Missing Pub/Sub OIDC configuration");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Missing Pub/Sub bearer token");
  const payload = (await new OAuth2Client().verifyIdToken({ idToken: token, audience })).getPayload();
  if (!payload || payload.email !== serviceAccount || payload.email_verified !== true) {
    throw new Error("Invalid Pub/Sub identity");
  }
  return payload;
}
