import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { buildCalendarOAuthUrl, matchesIntegrationTrigger, normalizeWebhookEvent, verifyGitHubWebhook, verifyStripeWebhook } from "./integrations";

describe("integration webhooks", () => {
  test("verifies GitHub and Stripe signatures against the raw body", () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment_intent.payment_failed", created: 1_700_000_000 });
    const githubSecret = "github-test-secret";
    const githubSignature = `sha256=${createHmac("sha256", githubSecret).update(body).digest("hex")}`;
    expect(verifyGitHubWebhook(body, githubSignature, githubSecret)).toBe(true);
    expect(verifyGitHubWebhook(`${body} `, githubSignature, githubSecret)).toBe(false);

    const stripeSecret = "whsec_test_secret";
    const timestamp = 1_700_000_000;
    const stripeSignature = createHmac("sha256", stripeSecret).update(`${timestamp}.${body}`).digest("hex");
    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${stripeSignature}`, stripeSecret, timestamp * 1000)).toBe(true);
    expect(verifyStripeWebhook(body, `t=${timestamp - 301},v1=${stripeSignature}`, stripeSecret, timestamp * 1000)).toBe(false);
  });

  test("requires stable delivery ids and builds calendar OAuth with read-only access", () => {
    const event = normalizeWebhookEvent("github", JSON.stringify({ action: "opened", repository: { full_name: "acme/api", updated_at: "2026-08-25T00:00:00Z" } }), new Headers({ "x-github-delivery": "delivery-1", "x-github-event": "pull_request" }));
    expect(event).toEqual({ id: "delivery-1", name: "pull_request.opened", summary: "GitHub pull_request.opened in acme/api", occurredAt: "2026-08-25T00:00:00Z" });
    const url = new URL(buildCalendarOAuthUrl({ clientId: "client", redirectUri: "https://example.com/callback", state: "state" }));
    expect(url.searchParams.get("scope")).toContain("calendar.events.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  test("matches exact event names and every requested keyword", () => {
    const trigger = { provider: "github" as const, eventNames: ["workflow_run.completed"], keywords: ["api", "failure"] };
    const event = { provider: "github", name: "workflow_run.completed", summary: "API production failure", occurredAt: "2026-08-25T12:00:00Z" };
    expect(matchesIntegrationTrigger(trigger, event, "2026-08-25T11:00:00Z")).toBe(true);
    expect(matchesIntegrationTrigger(trigger, { ...event, summary: "API succeeded" })).toBe(false);
    expect(matchesIntegrationTrigger(trigger, event, "2026-08-25T13:00:00Z")).toBe(false);
  });

  test("matches Google Calendar events only inside the configured start window", () => {
    const trigger = { provider: "google_calendar" as const, eventNames: ["event.starting"], keywords: [], withinMinutes: 15 };
    const event = { provider: "google_calendar", name: "event.starting", summary: "Standup", occurredAt: "2026-08-25T12:10:00Z" };
    const now = new Date("2026-08-25T12:00:00Z");
    expect(matchesIntegrationTrigger(trigger, event, null, now)).toBe(true);
    expect(matchesIntegrationTrigger(trigger, { ...event, occurredAt: "2026-08-25T12:16:00Z" }, null, now)).toBe(false);
    expect(matchesIntegrationTrigger(trigger, { ...event, occurredAt: "2026-08-25T11:59:00Z" }, null, now)).toBe(false);
  });
});
