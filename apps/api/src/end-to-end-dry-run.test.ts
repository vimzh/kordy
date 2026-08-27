// Exercises saved trigger plans through source matching, persistence, and the intercepted CALL-E boundary.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { dispatchCalleCall } from "./call-dispatch";
import {
  claimIntegrationTaskRun,
  claimNotionTaskRun,
  claimTaskRun,
  claimVercelTaskRun,
  createTask,
  db,
  enqueueGmailNotification,
  getNotionConnection,
  getVercelConnection,
  initializeDatabase,
  listTaskRuns,
  markTaskRunDispatched,
  persistGmailMessage,
  persistIntegrationEvent,
  persistNotionPage,
  persistVercelDeployment,
  recordCalendarTaskEvent,
  recordPublicSignal,
  saveCallTask,
  saveGmailConnection,
  saveIntegrationConnection,
  saveNotionConnection,
  saveVercelConnection,
  upsertUser,
  type GmailConnection,
  type GmailTaskTrigger,
  type IntegrationConnection,
  type IntegrationTaskTrigger,
  type NotionTaskTrigger,
  type PublicTaskTrigger,
  type TaskAction,
  type TaskTrigger,
  type VercelTaskTrigger,
} from "./db";
import { passesGmailRuleFilter, type WorkerTask } from "./gmail-worker";
import type { ParsedGmailMessage } from "./gmail";
import { matchesIntegrationTrigger, type IntegrationEvent, type IntegrationProvider } from "./integrations";
import { matchesNotionPage } from "./notion";
import { evaluatePublicTrigger, publicSourceState, shouldFirePublicSignal } from "./public-sources";
import { users } from "./schema";
import { matchesVercelDeployment, type VercelDeployment } from "./vercel";
import type { CalleSource } from "./calle";

const userId = `dry-run-${crypto.randomUUID()}`;
const budgetUserId = `${userId}-budget`;
const phone = "+12025550123";
const gmailConnectionId = `${userId}-gmail`;
const vercelConnectionId = `${userId}-vercel`;
const notionConnectionId = `${userId}-notion`;
const integrationIds: Record<IntegrationProvider, string> = {
  github: `${userId}-github`,
  stripe: `${userId}-stripe`,
  google_calendar: `${userId}-calendar`,
  n8n: `${userId}-n8n`,
};

let gmailConnection: GmailConnection;
let vercelConnection: NonNullable<Awaited<ReturnType<typeof getVercelConnection>>>;
let notionConnection: NonNullable<Awaited<ReturnType<typeof getNotionConnection>>>;
const integrationConnections = new Map<IntegrationProvider, IntegrationConnection>();

beforeAll(async () => {
  await initializeDatabase();
  await upsertUser({ sub: userId, email: `${userId}@example.com`, name: "Dry Run", picture: "" });
  await saveGmailConnection({ id: gmailConnectionId, userId, gmailAddress: "dry-run@gmail.com", encryptedRefreshToken: "test", grantedScopes: [], labelMap: { IMPORTANT: "IMPORTANT", INBOX: "INBOX" }, status: "connected", historyId: "1" });
  gmailConnection = { id: gmailConnectionId, userId, gmailAddress: "dry-run@gmail.com", encryptedRefreshToken: "test", grantedScopes: [], labelMap: { IMPORTANT: "IMPORTANT", INBOX: "INBOX" }, status: "connected", historyId: "1", watchExpiration: null, lastSyncedAt: null };
  await saveVercelConnection({ id: vercelConnectionId, userId, accountId: "account", accountName: "Dry Run", accountSlug: "dry-run", teamId: null, encryptedAccessToken: "test", projects: [{ id: "project-api", name: "api" }, { id: "project-web", name: "web" }], status: "connected" });
  await saveNotionConnection({ id: notionConnectionId, userId, workspaceId: "workspace", workspaceName: "Dry Run", workspaceIcon: null, encryptedAccessToken: "test", encryptedRefreshToken: "test", pages: [{ id: "page-runbook", title: "Incident Runbook", url: "https://notion.test/runbook" }], status: "connected" });
  vercelConnection = (await getVercelConnection(userId, vercelConnectionId))!;
  notionConnection = (await getNotionConnection(userId, notionConnectionId))!;
  for (const provider of ["github", "stripe", "google_calendar", "n8n"] as const) {
    integrationConnections.set(provider, await saveIntegrationConnection({ id: integrationIds[provider], userId, provider, label: provider, encryptedCredential: "test", metadata: {}, status: "connected" }));
  }
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, budgetUserId));
});

type Scenario =
  | { prompt: string; kind: "gmail"; trigger: GmailTaskTrigger; message: ParsedGmailMessage }
  | { prompt: string; kind: "vercel"; trigger: VercelTaskTrigger; deployment: VercelDeployment }
  | { prompt: string; kind: "notion"; trigger: NotionTaskTrigger; page: { id: string; title: string; url: string; lastEditedTime: string; content: string } }
  | { prompt: string; kind: "integration"; trigger: IntegrationTaskTrigger; event: IntegrationEvent }
  | { prompt: string; kind: "public"; trigger: PublicTaskTrigger };

const json = (value: unknown) => Response.json(value);

const publicFetcher = (async (input: URL | RequestInfo) => {
  const url = new URL(String(input));
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  if (url.hostname === "api.met.no") return json({ properties: { meta: { updated_at: "2026-08-27T00:00:00Z" }, timeseries: [future, later].map((time) => ({ time, data: { next_1_hours: { details: { precipitation_amount: 2 } } } })) } });
  if (url.hostname === "data.sec.gov") return json({ filings: { recent: { form: ["8-K", "10-Q"], accessionNumber: ["0001", "0002"], filingDate: ["2026-08-27", "2026-08-26"], primaryDocument: ["8k.htm", "10q.htm"] } } });
  if (url.hostname === "earthquake.usgs.gov") return json({ features: [{ id: "quake-1", properties: { mag: 5.5, place: "near Bengaluru", time: Date.now() } }] });
  if (url.hostname === "eonet.gsfc.nasa.gov") return json({ events: [{ id: "wildfire-1", title: "Wildfire", categories: [{ title: "Wildfires" }], geometry: [{ date: new Date().toISOString() }] }] });
  if (url.hostname === "api.twelvedata.com") return json({ name: "Test Equity", datetime: "2026-08-27", timestamp: Math.floor(Date.now() / 1000), close: "3000", percent_change: "6.5", volume: "10000000" });
  if (url.hostname === "api.frankfurter.dev") return json({ date: "2026-08-27", base: "USD", quote: "INR", rate: 91 });
  throw new Error(`Unexpected public-data request: ${url.hostname}`);
}) as typeof fetch;

function connectionId(trigger: TaskTrigger) {
  if (trigger.type === "email.received") return { gmailConnectionId };
  if (trigger.type === "deployment.failed") return { vercelConnectionId };
  if (trigger.type === "notion.page.updated") return { notionConnectionId };
  if (trigger.type === "integration.event") return { integrationConnectionId: integrationIds[trigger.provider] };
  return {};
}

function calleSource(trigger: TaskTrigger): CalleSource {
  if (trigger.type === "email.received") return "gmail";
  if (trigger.type === "deployment.failed") return "vercel";
  if (trigger.type === "notion.page.updated") return "notion";
  if (trigger.type === "integration.event") return trigger.provider;
  if (trigger.type === "weather.rain_forecast") return "weather";
  if (trigger.type === "sec.filing.published") return "sec";
  if (trigger.type === "usgs.earthquake.detected") return "usgs";
  if (trigger.type === "nasa.event.opened") return "nasa";
  if (trigger.type === "fx.rate.threshold") return "fx";
  return "india";
}

async function createRun(index: number, scenario: Scenario, action: TaskAction) {
  const taskId = `${userId}-task-${index}`;
  const task = await createTask({ id: taskId, userId, requestId: `${userId}-request-${index}`, prompt: scenario.prompt, status: "active", trigger: scenario.trigger, action, parserModel: "dry-run", ...connectionId(scenario.trigger) });
  expect(task).toMatchObject({ id: taskId, status: "active", trigger: scenario.trigger });

  if (scenario.kind === "gmail") {
    const notificationId = `${userId}-notification-${index}`;
    expect(await enqueueGmailNotification({ id: notificationId, userId, gmailConnectionId, pubsubMessageId: `${userId}-pubsub-${index}`, historyId: String(index + 2) })).toBe(true);
    await persistGmailMessage(gmailConnection, scenario.message);
    const workerTask: WorkerTask = { id: taskId, userId, originalPrompt: scenario.prompt, instruction: action.task, phone, ...scenario.trigger };
    expect(passesGmailRuleFilter(workerTask, scenario.message)).toBe(true);
    return claimTaskRun({ taskId, notificationEventId: notificationId, messageId: scenario.message.id, decision: { matches: true, confidence: "high", reason: "Dry-run fixture matched the explicit Gmail rules." } });
  }

  if (scenario.kind === "vercel") {
    expect(matchesVercelDeployment(scenario.deployment, scenario.trigger)).toBe(true);
    const eventId = await persistVercelDeployment({ connection: vercelConnection, deployment: scenario.deployment });
    expect(eventId).not.toBeNull();
    return claimVercelTaskRun({ taskId, eventId: eventId!, requiresApproval: action.executionMode === "approval" });
  }

  if (scenario.kind === "notion") {
    expect(matchesNotionPage(scenario.page, scenario.trigger)).toBe(true);
    const eventId = await persistNotionPage({ connection: notionConnection, page: scenario.page });
    expect(eventId).not.toBeNull();
    return claimNotionTaskRun({ taskId, eventId: eventId!, requiresApproval: action.executionMode === "approval", evidence: ["Dry-run Notion match", "source:notion"] });
  }

  if (scenario.kind === "integration") {
    const connection = integrationConnections.get(scenario.trigger.provider)!;
    expect(matchesIntegrationTrigger(scenario.trigger, { ...scenario.event, provider: scenario.trigger.provider })).toBe(true);
    if (scenario.trigger.provider === "google_calendar") return recordCalendarTaskEvent(connection, { id: taskId, action }, scenario.event);
    const eventId = await persistIntegrationEvent(connection, scenario.event);
    expect(eventId).not.toBeNull();
    return claimIntegrationTaskRun({ taskId, eventId: eventId!, requiresApproval: action.executionMode === "approval", evidence: [`Dry-run ${scenario.trigger.provider} match`, "source:integration"] });
  }

  const signal = await evaluatePublicTrigger(scenario.trigger, publicFetcher);
  expect(signal.matched).toBe(true);
  const previous = { matched: signal.kind === "event", fingerprint: "baseline" };
  expect(shouldFirePublicSignal(previous, signal)).toBe(true);
  return recordPublicSignal({ id: taskId, userId, trigger: scenario.trigger, action }, signal, publicSourceState(signal), true);
}

test("64 call-me scenarios reach the CALL-E request boundary without making a phone call", async () => {
  process.env.PUBLIC_DATA_USER_AGENT = "Kyub dry-run test@example.com";
  process.env.TWELVE_DATA_API_KEY = "test-key";
  const occurredAt = new Date(Date.now() + 60_000).toISOString();
  const message = (id: string, sender: string, subject: string, body: string, labelIds: string[] = ["INBOX"]): ParsedGmailMessage => ({ id, threadId: `thread-${id}`, sender, subject, snippet: body, body, labelIds, receivedAt: occurredAt });
  const deployment = (uid: string, name: string, projectId: string, target: "production" | "preview" | null): VercelDeployment => ({ uid, name, projectId, target, url: `${uid}.vercel.app`, created: Date.now() + 60_000 });
  const page = (id: string, title: string) => ({ id, title, url: `https://notion.test/${id}`, lastEditedTime: occurredAt, content: `${title} changed` });
  const event = (id: string, name: string, summary: string): IntegrationEvent => ({ id, name, summary, occurredAt });
  const scenarios: Scenario[] = [
    { prompt: "Call me when Alice emails", kind: "gmail", trigger: { type: "email.received", match: "and", senders: ["alice@example.com"], subjectKeywords: [], bodyKeywords: [], labels: [] }, message: message("gmail-1", "Alice <alice@example.com>", "Hello", "Checking in") },
    { prompt: "Call me when Bob emails", kind: "gmail", trigger: { type: "email.received", match: "and", senders: ["bob@example.com"], subjectKeywords: [], bodyKeywords: [], labels: [] }, message: message("gmail-2", "bob@example.com", "Update", "Project update") },
    { prompt: "Call me when an invoice email arrives", kind: "gmail", trigger: { type: "email.received", match: "and", senders: [], subjectKeywords: ["invoice"], bodyKeywords: [], labels: [] }, message: message("gmail-3", "billing@example.com", "August invoice", "Attached") },
    { prompt: "Call me when an email says overdue", kind: "gmail", trigger: { type: "email.received", match: "and", senders: [], subjectKeywords: [], bodyKeywords: ["overdue"], labels: [] }, message: message("gmail-4", "billing@example.com", "Payment", "The payment is overdue") },
    { prompt: "Call me for important renewal emails", kind: "gmail", trigger: { type: "email.received", match: "and", senders: [], subjectKeywords: ["renewal"], bodyKeywords: [], labels: ["IMPORTANT"] }, message: message("gmail-5", "vendor@example.com", "Renewal notice", "Review terms", ["INBOX", "IMPORTANT"]) },
    { prompt: "Call me when the API production deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: ["project-api"], projectNames: [], environments: ["production"] }, deployment: deployment("deploy-1", "api", "project-api", "production") },
    { prompt: "Call me when the web preview deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: [], projectNames: ["WEB"], environments: ["preview"] }, deployment: deployment("deploy-2", "web", "project-web", "preview") },
    { prompt: "Call me when any production deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: [], projectNames: [], environments: ["production"] }, deployment: deployment("deploy-3", "worker", "project-worker", "production") },
    { prompt: "Call me when any deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: [], projectNames: [], environments: [] }, deployment: deployment("deploy-4", "docs", "project-docs", null) },
    { prompt: "Call me when the incident runbook page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: ["page-runbook"], pageTitles: [], keywords: [] }, page: page("page-runbook", "Incident Runbook") },
    { prompt: "Call me when the roadmap page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: [], pageTitles: ["roadmap"], keywords: [] }, page: page("page-roadmap", "Roadmap") },
    { prompt: "Call me when any shared Notion page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: [], pageTitles: [], keywords: [] }, page: page("page-any", "Notes") },
    { prompt: "Call me when either selected Notion page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: ["page-secondary"], pageTitles: ["Incident Runbook"], keywords: [] }, page: page("page-runbook-copy", "Incident Runbook") },
    { prompt: "Call me when a GitHub pull request opens", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["pull_request.opened"], keywords: [], withinMinutes: 0 }, event: event("github-1", "pull_request.opened", "GitHub pull_request.opened in acme/api") },
    { prompt: "Call me when the API GitHub workflow fails", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["workflow_run.completed"], keywords: ["api", "failure"], withinMinutes: 0 }, event: event("github-2", "workflow_run.completed", "API production failure") },
    { prompt: "Call me when a GitHub issue opens", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["issues.opened"], keywords: [], withinMinutes: 0 }, event: event("github-3", "issues.opened", "GitHub issues.opened in acme/web") },
    { prompt: "Call me when a Stripe payment fails", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["payment_intent.payment_failed"], keywords: [], withinMinutes: 0 }, event: event("stripe-1", "payment_intent.payment_failed", "Stripe payment_intent.payment_failed") },
    { prompt: "Call me when a Stripe invoice payment fails", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["invoice.payment_failed"], keywords: [], withinMinutes: 0 }, event: event("stripe-2", "invoice.payment_failed", "Stripe invoice.payment_failed") },
    { prompt: "Call me when Stripe refunds a charge", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["charge.refunded"], keywords: [], withinMinutes: 0 }, event: event("stripe-3", "charge.refunded", "Stripe charge.refunded") },
    { prompt: "Call me when n8n reports a hot lead", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["lead.hot"], keywords: ["enterprise"], withinMinutes: 0 }, event: event("n8n-1", "lead.hot", "Enterprise lead reached hot status") },
    { prompt: "Call me when n8n reports low inventory", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["inventory.low"], keywords: ["warehouse"], withinMinutes: 0 }, event: event("n8n-2", "inventory.low", "Warehouse inventory is low") },
    { prompt: "Call me when an n8n workflow errors", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["workflow.error"], keywords: [], withinMinutes: 0 }, event: event("n8n-3", "workflow.error", "n8n workflow.error") },
    { prompt: "Call me when my calendar event starts within 15 minutes", kind: "integration", trigger: { type: "integration.event", provider: "google_calendar", eventNames: ["event.starting"], keywords: [], withinMinutes: 15 }, event: event("calendar-1", "event.starting", "Team standup") },
    { prompt: "Call me when rain is forecast in Bengaluru", kind: "public", trigger: { type: "weather.rain_forecast", location: "Bengaluru", latitude: 12.97, longitude: 77.59, minimumPrecipitationMm: 1, withinHours: 24, consecutiveHours: 1 } },
    { prompt: "Call me when Mumbai has two hours of rain", kind: "public", trigger: { type: "weather.rain_forecast", location: "Mumbai", latitude: 19.08, longitude: 72.88, minimumPrecipitationMm: 1, withinHours: 24, consecutiveHours: 2 } },
    { prompt: "Call me when Apple files an 8-K", kind: "public", trigger: { type: "sec.filing.published", cik: "320193", companyName: "Apple", forms: ["8-K"] } },
    { prompt: "Call me when Tesla files a 10-Q", kind: "public", trigger: { type: "sec.filing.published", cik: "1318605", companyName: "Tesla", forms: ["10-Q"] } },
    { prompt: "Call me after a magnitude 5 earthquake near Bengaluru", kind: "public", trigger: { type: "usgs.earthquake.detected", location: "Bengaluru", latitude: 12.97, longitude: 77.59, radiusKm: 100, minimumMagnitude: 5 } },
    { prompt: "Call me when NASA reports a wildfire", kind: "public", trigger: { type: "nasa.event.opened", categories: ["wildfires"], location: "", bbox: [] } },
    { prompt: "Call me when USD INR rises above 90", kind: "public", trigger: { type: "fx.rate.threshold", base: "USD", quote: "INR", operator: "above", threshold: 90 } },
    { prompt: "Call me when USD INR falls below 100", kind: "public", trigger: { type: "fx.rate.threshold", base: "USD", quote: "INR", operator: "below", threshold: 100 } },
    { prompt: "Call me when RELIANCE closes above 2500 on NSE", kind: "public", trigger: { type: "india.stock.price_threshold", symbol: "RELIANCE", companyName: "Reliance Industries", exchange: "NSE", operator: "above", price: 2500 } },
    { prompt: "Call me when TCS gains 5 percent on NSE", kind: "public", trigger: { type: "india.stock.daily_move", symbol: "TCS", companyName: "Tata Consultancy Services", exchange: "NSE", direction: "gain", percent: 5 } },
    { prompt: "Call me when 500180 trades over five million shares on BSE", kind: "public", trigger: { type: "india.stock.volume_threshold", symbol: "500180", companyName: "HDFC Bank", exchange: "BSE", minimumVolume: 5_000_000 } },
    { prompt: "Call me when finance@example.com sends a budget email", kind: "gmail", trigger: { type: "email.received", match: "and", senders: ["finance@example.com"], subjectKeywords: ["budget"], bodyKeywords: [], labels: [] }, message: message("gmail-6", "Finance <finance@example.com>", "Budget approved", "Review the allocation") },
    { prompt: "Call me when a security email says reset required", kind: "gmail", trigger: { type: "email.received", match: "and", senders: [], subjectKeywords: ["security"], bodyKeywords: ["reset required"], labels: [] }, message: message("gmail-7", "security@example.com", "Security notice", "Password reset required today") },
    { prompt: "Call me when either Alpha or Beta emails", kind: "gmail", trigger: { type: "email.received", match: "and", senders: ["alpha@example.com", "beta@example.com"], subjectKeywords: [], bodyKeywords: [], labels: [] }, message: message("gmail-8", "Beta Team <beta@example.com>", "Status", "Ready") },
    { prompt: "Call me for important emails that say urgent", kind: "gmail", trigger: { type: "email.received", match: "and", senders: [], subjectKeywords: [], bodyKeywords: ["urgent"], labels: ["IMPORTANT"] }, message: message("gmail-9", "ops@example.com", "Incident", "Urgent response needed", ["INBOX", "IMPORTANT"]) },
    { prompt: "Call me when legal@example.com sends an important contract email requiring signature", kind: "gmail", trigger: { type: "email.received", match: "and", senders: ["legal@example.com"], subjectKeywords: ["contract"], bodyKeywords: ["signature"], labels: ["IMPORTANT"] }, message: message("gmail-10", "Legal <legal@example.com>", "Contract review", "Signature is required", ["INBOX", "IMPORTANT"]) },
    { prompt: "Call me when the API preview deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: ["project-api"], projectNames: [], environments: ["preview"] }, deployment: deployment("deploy-5", "api", "project-api", "preview") },
    { prompt: "Call me when the web production deployment fails", kind: "vercel", trigger: { type: "deployment.failed", projectIds: [], projectNames: ["web"], environments: ["production"] }, deployment: deployment("deploy-6", "web", "project-web", "production") },
    { prompt: "Call me when the API deployment fails using either project selector", kind: "vercel", trigger: { type: "deployment.failed", projectIds: ["missing-project"], projectNames: ["API"], environments: [] }, deployment: deployment("deploy-7", "api", "project-api", "production") },
    { prompt: "Call me when the API fails in preview or production", kind: "vercel", trigger: { type: "deployment.failed", projectIds: ["project-api"], projectNames: [], environments: ["preview", "production"] }, deployment: deployment("deploy-8", "api", "project-api", "preview") },
    { prompt: "Call me when the security playbook page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: [], pageTitles: ["security playbook"], keywords: [] }, page: page("page-security", "Security Playbook") },
    { prompt: "Call me when the launch checklist page changes", kind: "notion", trigger: { type: "notion.page.updated", pageIds: ["page-launch"], pageTitles: [], keywords: [] }, page: page("page-launch", "Launch Checklist") },
    { prompt: "Call me when any Notion page mentions data retention", kind: "notion", trigger: { type: "notion.page.updated", pageIds: [], pageTitles: [], keywords: ["data retention"] }, page: { ...page("page-policy", "Policy Notes"), content: "Data retention policy changed" } },
    { prompt: "Call me when the Ops Manual changes using either Notion selector", kind: "notion", trigger: { type: "notion.page.updated", pageIds: ["missing-page"], pageTitles: ["ops manual"], keywords: [] }, page: page("page-ops", "Ops Manual") },
    { prompt: "Call me when GitHub pushes to main", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["push"], keywords: ["main"], withinMinutes: 0 }, event: event("github-4", "push", "GitHub push to main in acme/api") },
    { prompt: "Call me when GitHub publishes a stable release", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["release.published"], keywords: ["stable"], withinMinutes: 0 }, event: event("github-5", "release.published", "GitHub stable release published") },
    { prompt: "Call me when GitHub reports a failed deployment status", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["deployment_status"], keywords: ["failure"], withinMinutes: 0 }, event: event("github-6", "deployment_status", "GitHub deployment status failure") },
    { prompt: "Call me when Stripe completes checkout", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["checkout.session.completed"], keywords: [], withinMinutes: 0 }, event: event("stripe-4", "checkout.session.completed", "Stripe checkout.session.completed") },
    { prompt: "Call me when Stripe deletes a churned subscription", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["customer.subscription.deleted"], keywords: ["churn"], withinMinutes: 0 }, event: event("stripe-5", "customer.subscription.deleted", "Stripe subscription deleted after churn") },
    { prompt: "Call me when Stripe creates a dispute", kind: "integration", trigger: { type: "integration.event", provider: "stripe", eventNames: ["charge.dispute.created"], keywords: [], withinMinutes: 0 }, event: event("stripe-6", "charge.dispute.created", "Stripe charge.dispute.created") },
    { prompt: "Call me when n8n reports an enterprise P1 SLA breach", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["sla.breached"], keywords: ["enterprise", "p1"], withinMinutes: 0 }, event: event("n8n-4", "sla.breached", "Enterprise customer P1 SLA breached") },
    { prompt: "Call me when the n8n database backup fails", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["backup.failed"], keywords: ["database"], withinMinutes: 0 }, event: event("n8n-5", "backup.failed", "Database backup failed") },
    { prompt: "Call me when n8n receives a form submission", kind: "integration", trigger: { type: "integration.event", provider: "n8n", eventNames: ["form.submitted"], keywords: [], withinMinutes: 0 }, event: event("n8n-6", "form.submitted", "n8n form submitted") },
    { prompt: "Call me when the board review starts within 30 minutes", kind: "integration", trigger: { type: "integration.event", provider: "google_calendar", eventNames: ["event.starting"], keywords: ["board review"], withinMinutes: 30 }, event: event("calendar-2", "event.starting", "Board review") },
    { prompt: "Call me when my flight check-in event starts within an hour", kind: "integration", trigger: { type: "integration.event", provider: "google_calendar", eventNames: ["event.starting"], keywords: ["flight check-in"], withinMinutes: 60 }, event: event("calendar-3", "event.starting", "Flight check-in") },
    { prompt: "Call me when Delhi has two hours with at least 2 mm of rain", kind: "public", trigger: { type: "weather.rain_forecast", location: "Delhi", latitude: 28.61, longitude: 77.21, minimumPrecipitationMm: 2, withinHours: 12, consecutiveHours: 2 } },
    { prompt: "Call me when Apple files a 10-Q", kind: "public", trigger: { type: "sec.filing.published", cik: "320193", companyName: "Apple", forms: ["10-Q"] } },
    { prompt: "Call me after a magnitude 5.5 earthquake near Delhi", kind: "public", trigger: { type: "usgs.earthquake.detected", location: "Delhi", latitude: 28.61, longitude: 77.21, radiusKm: 250, minimumMagnitude: 5.5 } },
    { prompt: "Call me when NASA reports a wildfire in this bounding box", kind: "public", trigger: { type: "nasa.event.opened", categories: ["wildfires"], location: "Northern India", bbox: [68, 37, 98, 8] } },
    { prompt: "Call me when USD INR falls below 95", kind: "public", trigger: { type: "fx.rate.threshold", base: "USD", quote: "INR", operator: "below", threshold: 95 } },
    { prompt: "Call me when RELIANCE closes below 3500 on NSE", kind: "public", trigger: { type: "india.stock.price_threshold", symbol: "RELIANCE", companyName: "Reliance Industries", exchange: "NSE", operator: "below", price: 3500 } },
  ];
  expect(scenarios).toHaveLength(64);

  const originalFetch = globalThis.fetch;
  const originalLimit = process.env.CALLE_DAILY_CALL_LIMIT;
  const originalKey = process.env.CALLE_API_KEY;
  const originalBase = process.env.CALLE_BASE_URL;
  const originalWebhook = process.env.CALLE_WEBHOOK_URL;
  const requests: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = [];
  process.env.CALLE_DAILY_CALL_LIMIT = "1000";
  process.env.CALLE_API_KEY = "dry-run-key";
  process.env.CALLE_BASE_URL = "https://dry-run.invalid";
  process.env.CALLE_WEBHOOK_URL = "https://dry-run.invalid/webhooks/calle";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url !== "https://dry-run.invalid/v1/calls") throw new Error(`Unexpected outbound request: ${url}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, init, body });
    return Response.json({ id: `call_dry_${requests.length}`, status: "queued", task: body.task });
  }) as typeof fetch;

  try {
    for (const [index, scenario] of scenarios.entries()) {
      const action: TaskAction = { type: "calle.call", targetType: "self", targetName: "Dry Run", phone, task: scenario.prompt, executionMode: "automatic" };
      const run = await createRun(index, scenario, action);
      expect(run).not.toBeNull();
      expect(run?.awaitingApproval).toBeFalsy();
      const source = calleSource(scenario.trigger);
      const call = await dispatchCalleCall({ task: `${action.task}\n\nDry-run source matched.`, phone, userId, eventId: `dry-run:${index}`, source });
      await saveCallTask({ id: call.id, userId, task: action.task, phone, source, status: call.status, taskRunId: run!.id });
      await markTaskRunDispatched(run!.id, call.id);
    }

    expect(requests).toHaveLength(64);
    expect(requests.every(({ init }) => init?.method === "POST")).toBe(true);
    expect(requests.every(({ init }) => new Headers(init?.headers).get("Authorization") === "Bearer dry-run-key")).toBe(true);
    expect(requests.every(({ body }) => (body.recipients as Array<{ phones: string[] }>)[0]?.phones[0] === phone)).toBe(true);
    expect(requests.every(({ body }) => body.webhook_url === "https://dry-run.invalid/webhooks/calle")).toBe(true);
    const runs = (await listTaskRuns(userId)).filter((run) => run.taskId.startsWith(`${userId}-task-`));
    expect(runs).toHaveLength(64);
    expect(runs.every((run) => run.status === "calling" && Boolean(run.callId))).toBe(true);

    const approvalScenario: Scenario = { prompt: "Call me after I approve a GitHub release event", kind: "integration", trigger: { type: "integration.event", provider: "github", eventNames: ["release.published"], keywords: [], withinMinutes: 0 }, event: event("github-approval", "release.published", "GitHub release.published") };
    const approvalRun = await createRun(64, approvalScenario, { type: "calle.call", targetType: "self", targetName: "Dry Run", phone, task: approvalScenario.prompt, executionMode: "approval" });
    expect(approvalRun?.awaitingApproval).toBe(true);
    expect(requests).toHaveLength(64);

    await upsertUser({ sub: budgetUserId, email: `${budgetUserId}@example.com` });
    process.env.CALLE_DAILY_CALL_LIMIT = "1";
    await dispatchCalleCall({ task: "First budgeted dry run", phone, userId: budgetUserId, eventId: "first", source: "generic" });
    await expect(dispatchCalleCall({ task: "Blocked budget dry run", phone, userId: budgetUserId, eventId: "second", source: "generic" })).rejects.toThrow("Daily CALL-E call limit reached");
    expect(requests).toHaveLength(65);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLimit === undefined) delete process.env.CALLE_DAILY_CALL_LIMIT; else process.env.CALLE_DAILY_CALL_LIMIT = originalLimit;
    if (originalKey === undefined) delete process.env.CALLE_API_KEY; else process.env.CALLE_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.CALLE_BASE_URL; else process.env.CALLE_BASE_URL = originalBase;
    if (originalWebhook === undefined) delete process.env.CALLE_WEBHOOK_URL; else process.env.CALLE_WEBHOOK_URL = originalWebhook;
  }
});
