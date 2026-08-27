// Verifies inbound integration webhooks and reads Google Calendar events.
import { createHmac, timingSafeEqual } from "node:crypto";

export type IntegrationProvider = "github" | "stripe" | "google_calendar" | "n8n";

export type IntegrationEvent = {
  id: string;
  name: string;
  summary: string;
  occurredAt: string;
};

function equalHex(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyGitHubWebhook(rawBody: string, signature: string | undefined, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  return equalHex(signature.slice(7), createHmac("sha256", secret).update(rawBody).digest("hex"));
}

export function verifyStripeWebhook(rawBody: string, signature: string | undefined, secret: string, now = Date.now()) {
  if (!signature) return false;
  const parts = signature.split(",").map((part) => part.split("=", 2) as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return parts.some(([key, value]) => key === "v1" && equalHex(value, expected));
}

export function matchesIntegrationTrigger(trigger: { provider: IntegrationProvider; eventNames: string[]; keywords: string[]; withinMinutes?: number }, event: { provider: string; name: string; summary: string; occurredAt: string }, activationAt?: string | null, now = new Date()) {
  const occurredAt = Date.parse(event.occurredAt);
  if (trigger.provider !== event.provider || !Number.isFinite(occurredAt) || (activationAt && occurredAt < Date.parse(activationAt))) return false;
  if (trigger.provider === "google_calendar" && trigger.withinMinutes !== undefined) {
    if (occurredAt < now.getTime() || occurredAt > now.getTime() + trigger.withinMinutes * 60_000) return false;
  }
  const names = trigger.eventNames.map((value) => value.toLowerCase());
  const summary = event.summary.toLowerCase();
  return (!names.length || names.includes(event.name.toLowerCase())) && trigger.keywords.every((keyword) => summary.includes(keyword.toLowerCase()));
}

export function normalizeWebhookEvent(provider: Exclude<IntegrationProvider, "google_calendar">, rawBody: string, headers: Headers): IntegrationEvent {
  const body = JSON.parse(rawBody) as Record<string, any>;
  if (provider === "github") {
    const delivery = headers.get("x-github-delivery");
    const event = headers.get("x-github-event");
    if (!delivery || !event) throw new Error("GitHub delivery headers are required");
    const action = typeof body.action === "string" ? `.${body.action}` : "";
    const repository = body.repository?.full_name ? ` in ${body.repository.full_name}` : "";
    return { id: delivery, name: `${event}${action}`, summary: `GitHub ${event}${action}${repository}`, occurredAt: body.repository?.updated_at ?? new Date().toISOString() };
  }
  if (provider === "stripe") {
    if (typeof body.id !== "string" || typeof body.type !== "string") throw new Error("Stripe event id and type are required");
    return { id: body.id, name: body.type, summary: `Stripe ${body.type}`, occurredAt: new Date(Number(body.created) * 1000 || Date.now()).toISOString() };
  }
  if (typeof body.id !== "string" || typeof body.event !== "string") throw new Error("n8n payload requires string id and event fields");
  return { id: body.id, name: body.event, summary: typeof body.summary === "string" ? body.summary : `n8n ${body.event}`, occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : new Date().toISOString() };
}

export function buildCalendarOAuthUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/calendar.events.readonly",
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

export async function exchangeCalendarCode(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; scope?: string; expires_in?: number }>;
}

export async function refreshCalendarToken(refreshToken: string, clientId: string, clientSecret: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; expires_in?: number }>;
}

export async function getGoogleIdentity(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google identity request failed (${response.status})`);
  const profile = await response.json() as { email?: string };
  if (!profile.email) throw new Error("Google account email is unavailable");
  return profile.email;
}

export async function listUpcomingCalendarEvents(accessToken: string, now = new Date()) {
  const query = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Calendar request failed (${response.status})`);
  const body = await response.json() as { items?: Array<{ id?: string; summary?: string; status?: string; start?: { dateTime?: string; date?: string }; updated?: string }> };
  return (body.items ?? []).flatMap((event): IntegrationEvent[] => {
    const start = event.start?.dateTime ?? event.start?.date;
    if (!event.id || !start || event.status === "cancelled") return [];
    return [{ id: `${event.id}:${start}`, name: "event.starting", summary: event.summary ?? "Calendar event", occurredAt: new Date(start).toISOString() }];
  });
}
