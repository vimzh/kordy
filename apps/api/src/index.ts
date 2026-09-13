// Hono API for authentication, source connections, persisted tasks, and provider webhooks.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clearSession, cookieValue, currentSession, loginWithDemoCredentials, oauthReturnTo, sessionCookie, setOAuthReturnTo, type Session } from "./auth";
import {
  answeredBy, CalleApiError, calleSources, confirmedPhoneOwnership, confirmedReplyInstruction, getCalleCall,
  normalizeCallLocale, normalizeCallRegion, normalizePhone, type CalleSource,
} from "./calle";
import { CallBudgetExceededError, dailyCallLimit, dispatchCalleCall as createCalleCall, OutboundCallConsentRequiredError, PhoneVerificationRequiredError } from "./call-dispatch";
import {
  callDispatchUsage, callMetrics, createContact, createTask, decideTaskRunApproval, deleteTask, disconnectGmail, disconnectIntegration, disconnectNotion, disconnectVercel, duplicateTask, enqueueGmailNotification, findTaskByRequest, getCallTask, getGmailConnection, getIntegrationConnectionById,
  getGmailConnectionsByAddress, getLatestVerificationCall, getProfile, getStoredCallTask, getTask, getTaskContext, initializeDatabase, listCallTasks, listContacts,
  listGmailConnections, listIntegrationConnections, listNotionConnections, listTaskRuns, listTasks, listVercelConnections, markApprovalsRead, persistIntegrationEvent, resolveTaskClarification, retryEmailReply, retryTaskCreation, saveCallTask, saveGmailConnection, saveIntegrationConnection, saveNotionConnection, saveVercelConnection, updateCallTask,
  markDefaultPhoneVerified, taskCreationCapacity, unreadApprovalCount, updateContactEmail, updateOutboundCallConsent, updateProfile, updateTask, updateTaskClarification, updateTaskStatus, upsertUser, type Task, type TaskAction, type TaskDelivery, type TaskTrigger,
} from "./db";
import {
  GMAIL_SCOPES, buildGmailOAuthUrl, decodePubSubPayload, decryptToken, encryptToken, exchangeGmailCode,
  getGmailProfile, listGmailLabels, verifyPubSubOidc, watchInbox,
} from "./gmail";
import { parseTaskPrompt, taskTriggerFromResult, TaskParserError, type TaskAgentContext, type TaskParseResult } from "./task-agent";
import { buildVercelInstallUrl, exchangeVercelCode, getVercelAccount, listVercelProjects } from "./vercel";
import { buildNotionOAuthUrl, exchangeNotionCode, listNotionPages, revokeNotionToken } from "./notion";
import { buildCalendarOAuthUrl, exchangeCalendarCode, getGoogleIdentity, normalizeWebhookEvent, verifyGitHubWebhook, verifyStripeWebhook, type IntegrationProvider } from "./integrations";

const app = new Hono();
const webOrigin = new URL(process.env.WEB_URL ?? "http://localhost:3006/home").origin;
const databaseReady = initializeDatabase();
const knownUsers = new Set<string>();
const taskHourlyLimit = 20;
const taskActiveLimit = 100;
const terminalCallStatuses = new Set(["completed", "failed", "canceled"]);

type Source = "gmail" | "vercel" | "notion" | IntegrationProvider | "weather" | "sec" | "usgs" | "nasa" | "fx" | "india";
const sourceAliases: Record<string, Source> = {
  gmail: "gmail",
  vercel: "vercel",
  notion: "notion",
  github: "github",
  stripe: "stripe",
  "google calendar": "google_calendar",
  n8n: "n8n",
  weather: "weather",
  sec: "sec",
  usgs: "usgs",
  "nasa eonet": "nasa",
  "foreign exchange": "fx",
  "indian stocks (eod)": "india",
};

function inferSource(prompt: string): Source {
  if (/\bgithub\b/i.test(prompt)) return "github";
  if (/\bstripe\b/i.test(prompt)) return "stripe";
  if (/\b(?:google calendar|calendar event|meeting starts?)\b/i.test(prompt)) return "google_calendar";
  if (/\bn8n\b/i.test(prompt)) return "n8n";
  if (/\b(?:weather|rain|precipitation)\b/i.test(prompt)) return "weather";
  if (/\b(?:SEC|EDGAR|filings?|8-K|10-[KQ])\b/i.test(prompt)) return "sec";
  if (/\b(?:USGS|earthquake|seismic)\b/i.test(prompt)) return "usgs";
  if (/\b(?:NASA|EONET|wildfire|volcano|landslide|natural event)\b/i.test(prompt)) return "nasa";
  if (/\b(?:foreign exchange|exchange rate|forex|FX|currency)\b/i.test(prompt)) return "fx";
  if (/\b(?:NSE|BSE|Indian stocks?|NIFTY|SENSEX|stocks?|share price|equity)\b/i.test(prompt)) return "india";
  if (/\bnotion\b/i.test(prompt)) return "notion";
  if (/\b(?:vercel|deploy(?:ment)?|build)\b/i.test(prompt)) return "vercel";
  return "gmail";
}

const taskStatuses: Task["status"][] = ["creating", "parsing", "draft", "active", "needs_clarification", "paused", "archived", "parse_failed"];
const triggerTypes = new Set(["email.received", "deployment.failed", "notion.page.updated", "integration.event", "weather.rain_forecast", "sec.filing.published", "usgs.earthquake.detected", "nasa.event.opened", "fx.rate.threshold", "india.stock.price_threshold", "india.stock.daily_move", "india.stock.volume_threshold"]);

function taskTrigger(value: unknown): TaskTrigger | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 20_000) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !triggerTypes.has(candidate.type)) return null;
  const strings = (key: string, max = 100) => Array.isArray(candidate[key]) && (candidate[key] as unknown[]).length <= max && (candidate[key] as unknown[]).every((item) => typeof item === "string" && item.length <= 500);
  const text = (key: string) => typeof candidate[key] === "string" && (candidate[key] as string).length > 0 && (candidate[key] as string).length <= 500;
  const number = (key: string) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]);
  const valid = candidate.type === "email.received" ? candidate.match === "and" && strings("senders", 20) && strings("subjectKeywords", 20) && strings("bodyKeywords", 20) && strings("labels", 20)
    : candidate.type === "deployment.failed" ? strings("projectIds") && strings("projectNames") && strings("environments", 2)
      : candidate.type === "notion.page.updated" ? strings("pageIds") && strings("pageTitles") && strings("keywords", 20)
        : candidate.type === "integration.event" ? ["github", "stripe", "google_calendar", "n8n"].includes(String(candidate.provider)) && strings("eventNames", 20) && strings("keywords", 20) && number("withinMinutes")
          : candidate.type === "weather.rain_forecast" ? text("location") && ["latitude", "longitude", "minimumPrecipitationMm", "withinHours", "consecutiveHours"].every(number)
            : candidate.type === "sec.filing.published" ? text("cik") && text("companyName") && strings("forms", 20)
              : candidate.type === "usgs.earthquake.detected" ? text("location") && ["latitude", "longitude", "radiusKm", "minimumMagnitude"].every(number)
                : candidate.type === "nasa.event.opened" ? strings("categories", 13) && typeof candidate.location === "string" && Array.isArray(candidate.bbox) && (candidate.bbox.length === 0 || candidate.bbox.length === 4 && candidate.bbox.every((item) => typeof item === "number" && Number.isFinite(item)))
                  : candidate.type === "fx.rate.threshold" ? text("base") && text("quote") && ["above", "below"].includes(String(candidate.operator)) && number("threshold")
                    : text("symbol") && text("companyName") && ["NSE", "BSE"].includes(String(candidate.exchange)) && (candidate.type === "india.stock.price_threshold" ? ["above", "below"].includes(String(candidate.operator)) && number("price") : candidate.type === "india.stock.daily_move" ? ["gain", "loss"].includes(String(candidate.direction)) && number("percent") : number("minimumVolume"));
  if (!valid) return null;
  return value as TaskTrigger;
}

function taskAction(value: unknown): TaskAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  const phone = typeof action.phone === "string" ? normalizePhone(action.phone) : null;
  if (action.type !== "calle.call" || (action.targetType !== "self" && action.targetType !== "contact") || action.targetType === "contact" && typeof action.targetId !== "string" || !phone || typeof action.targetName !== "string" || !action.targetName.trim() || typeof action.task !== "string" || !action.task.trim() || action.task.length > 4000) return null;
  return { ...action, phone, task: action.task.trim(), targetName: action.targetName.trim() } as TaskAction;
}

function taskDelivery(value: unknown): TaskDelivery | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const delivery: TaskDelivery = {};
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== "string") return null;
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { return null; }
    delivery.timezone = input.timezone;
  }
  for (const key of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input[key])) return null;
      delivery[key] = input[key];
    }
  }
  for (const [key, max] of [["cooldownMinutes", 10_080], ["maxCallsPerHour", 100], ["maxCallsPerDay", 1_000]] as const) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || (input[key] as number) < 0 || (input[key] as number) > max) return null;
      delivery[key] = input[key] as number;
    }
  }
  for (const key of ["startsAt", "expiresAt"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || !Number.isFinite(Date.parse(input[key]))) return null;
      delivery[key] = new Date(input[key]).toISOString();
    }
  }
  if (delivery.startsAt && delivery.expiresAt && delivery.startsAt >= delivery.expiresAt) return null;
  if (input.region !== undefined) {
    const region = typeof input.region === "string" ? normalizeCallRegion(input.region) : null;
    if (!region) return null;
    delivery.region = region;
  }
  if (input.locale !== undefined) {
    const locale = typeof input.locale === "string" ? normalizeCallLocale(input.locale) : null;
    if (!locale) return null;
    delivery.locale = locale;
  }
  return delivery;
}

app.use("*", cors({ origin: webOrigin, credentials: true }));

function requiredEnv(...names: string[]) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
}

function equalSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function user(c: Parameters<typeof currentSession>[0]) {
  const session = currentSession(c);
  if (session && !knownUsers.has(session.sub)) {
    await upsertUser(session);
    if (knownUsers.size >= 1_000) knownUsers.clear();
    knownUsers.add(session.sub);
  }
  return session;
}

function taskContext(session: Session, context: Awaited<ReturnType<typeof getTaskContext>>): TaskAgentContext {
  if (!context.profile) throw new Error("User profile was not found");
  return {
    currentUser: {
      id: session.sub,
      email: context.profile.email,
      name: context.profile.name,
      defaultPhone: context.profile.defaultPhone,
    },
    gmail: {
      connected: context.gmail?.status === "connected",
      email: context.gmail?.gmailAddress ?? null,
      labels: Object.keys(context.gmail?.labelMap ?? {}),
      labelIds: context.gmail?.labelMap ?? {},
    },
    vercel: {
      connected: context.vercel?.status === "connected",
      accountName: context.vercel?.accountName ?? null,
      projects: context.vercel?.projects ?? [],
    },
    notion: {
      connected: context.notion?.status === "connected",
      workspaceName: context.notion?.workspaceName ?? null,
      pages: context.notion?.pages.map(({ id, title }) => ({ id, title })) ?? [],
    },
    integration: {
      connected: context.integration?.status === "connected",
      provider: context.integration?.provider ?? null,
      label: context.integration?.label ?? null,
    },
    contacts: context.contacts.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
  };
}

function publicTaskResult(result: TaskParseResult, context: TaskAgentContext, executionMode: "automatic" | "approval" = "automatic") {
  if (result.status === "needs_clarification") return result;
  const target = result.action.target;
  const contact = target.type === "contact" ? context.contacts.find(({ id }) => id === target.contactId) : null;
  const phone = target.type === "self" ? context.currentUser.defaultPhone : contact?.phone;
  if (!phone || !normalizePhone(phone)) return { status: "needs_clarification" as const, question: "What E.164 phone number should Kordy call?" };
  const trigger = taskTriggerFromResult(result, context);
  const action: TaskAction = {
    type: "calle.call",
    targetType: target.type,
    ...(target.type === "contact" ? { targetId: target.contactId } : {}),
    targetName: target.type === "self" ? context.currentUser.name ?? "You" : contact?.name ?? "Contact",
    phone: normalizePhone(phone)!,
    task: result.action.task,
    executionMode,
  };
  return { status: "complete" as const, trigger, action };
}

async function parseWithContext(session: Session, prompt: string, connections: { gmailConnectionId?: string | null; vercelConnectionId?: string | null; notionConnectionId?: string | null; integrationConnectionId?: string | null }, executionMode: "automatic" | "approval" = "automatic") {
  const context = taskContext(session, await getTaskContext(session.sub, connections));
  const parsed = await parseTaskPrompt(prompt, context);
  return { context, result: publicTaskResult(parsed.result, context, executionMode), model: parsed.model };
}

async function onboardingSnapshot(userId: string) {
  const profile = await getProfile(userId);
  const tasks = await listTasks(userId);
  const capacity = await taskCreationCapacity(userId);
  const callsUsed = await callDispatchUsage(userId);
  const latestVerificationCall = await getLatestVerificationCall(userId);
  const gmail = await listGmailConnections(userId);
  const vercel = await listVercelConnections(userId);
  const notion = await listNotionConnections(userId);
  const integrations = await listIntegrationConnections(userId);
  if (!profile) throw new Error("User profile was not found");
  const allConnections = [
    ...gmail.map((connection) => ({ id: connection.id, provider: "gmail", label: connection.gmailAddress, status: connection.status })),
    ...vercel.map((connection) => ({ id: connection.id, provider: "vercel", label: connection.accountName, status: connection.status })),
    ...notion.map((connection) => ({ id: connection.id, provider: "notion", label: connection.workspaceName, status: connection.status })),
    ...integrations.map((connection) => ({ id: connection.id, provider: connection.provider, label: connection.label, status: connection.status })),
  ];
  const phone = Boolean(profile.defaultPhone);
  const consent = Boolean(profile.outboundCallConsentAt);
  const verified = Boolean(profile.phoneVerifiedAt);
  return {
    profile: { ...profile, readyForAutomaticCalls: phone && consent && verified },
    steps: {
      phone,
      consent,
      verified,
      connection: allConnections.some(({ status }) => status === "connected"),
      trigger: tasks.some(({ status }) => status !== "archived"),
    },
    usage: {
      callsUsed,
      callsLimit: dailyCallLimit(),
      tasksCreatedLastHour: capacity.recent,
      taskHourlyLimit,
      activeTasks: capacity.active,
      taskActiveLimit,
    },
    reconnectNeeded: allConnections.filter(({ status }) => status === "needs_reconnect").map(({ id, provider, label }) => ({ id, provider, label })),
    latestVerificationCall,
  };
}

function callErrorResponse(c: Parameters<typeof currentSession>[0], error: unknown) {
  if (error instanceof CallBudgetExceededError) return c.json({ error: error.message }, 429);
  if (error instanceof OutboundCallConsentRequiredError) return c.json({ error: error.message, code: "outbound_call_consent_required" }, 409);
  if (error instanceof PhoneVerificationRequiredError) return c.json({ error: error.message, code: "phone_verification_required" }, 409);
  if (error instanceof CalleApiError) {
    const provider = error.providerError;
    if (provider.retryAfterSeconds !== null) c.header("Retry-After", String(provider.retryAfterSeconds));
    const status = provider.code === "rate_limit_exceeded" ? 429
      : provider.code === "idempotency_conflict" ? 409
        : provider.code === "insufficient_balance" || provider.code === "provider_unavailable" ? 503
          : provider.status >= 400 && provider.status < 500 && provider.status !== 401 && provider.status !== 403 ? 422
            : 502;
    return c.json({ error: provider.message, code: provider.code, retryAfterSeconds: provider.retryAfterSeconds }, status as 422);
  }
  console.error(error);
  return c.json({ error: "Could not create the CALL-E call" }, 502);
}

app.get("/", (c) => c.text("Kordy API"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/auth/login", loginWithDemoCredentials);
app.get("/auth/me", async (c) => c.json({ user: await user(c) }));
app.post("/auth/logout", clearSession);

app.get("/profile", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ profile: await getProfile(session.sub) });
});

app.patch("/profile", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const update: { defaultPhone?: string | null; callRegion?: string | null; callLocale?: string | null; approvalExpiryMinutes?: number } = {};
  if ("defaultPhone" in (body ?? {})) {
    const phone = body.defaultPhone === null ? null : typeof body.defaultPhone === "string" ? normalizePhone(body.defaultPhone) : null;
    if (body.defaultPhone !== null && !phone) return c.json({ error: "defaultPhone must be a valid E.164 number" }, 400);
    update.defaultPhone = phone;
  }
  if ("callRegion" in (body ?? {})) {
    const region = body.callRegion === null ? null : typeof body.callRegion === "string" ? normalizeCallRegion(body.callRegion) : null;
    if (body.callRegion !== null && !region) return c.json({ error: "callRegion must be a supported CALL-E country code" }, 400);
    update.callRegion = region;
  }
  if ("callLocale" in (body ?? {})) {
    const locale = body.callLocale === null ? null : typeof body.callLocale === "string" ? normalizeCallLocale(body.callLocale) : null;
    if (body.callLocale !== null && !locale) return c.json({ error: "callLocale must be a valid BCP 47 locale" }, 400);
    update.callLocale = locale;
  }
  if ("approvalExpiryMinutes" in (body ?? {})) {
    if (!Number.isInteger(body.approvalExpiryMinutes) || body.approvalExpiryMinutes < 5 || body.approvalExpiryMinutes > 10_080) return c.json({ error: "approvalExpiryMinutes must be between 5 and 10080" }, 400);
    update.approvalExpiryMinutes = body.approvalExpiryMinutes;
  }
  if (!Object.keys(update).length) return c.json({ error: "At least one profile setting is required" }, 400);
  return c.json({ profile: await updateProfile(session.sub, update) });
});

app.get("/onboarding", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await onboardingSnapshot(session.sub));
});

app.post("/onboarding/consent", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.consent !== "boolean") return c.json({ error: "consent must be a boolean" }, 400);
  await updateOutboundCallConsent(session.sub, body.consent);
  return c.json(await onboardingSnapshot(session.sub));
});

app.post("/onboarding/test-call", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (body?.acknowledgeCost !== true) return c.json({ error: "acknowledgeCost must be true" }, 400);
  const profile = await getProfile(session.sub);
  if (!profile?.defaultPhone) return c.json({ error: "Save a default phone number before requesting a test call", code: "default_phone_required" }, 409);
  if (!profile.outboundCallConsentAt) return c.json({ error: "Outbound call consent is required", code: "outbound_call_consent_required" }, 409);
  if (profile.phoneVerifiedAt) return c.json({ error: "This phone number is already verified", code: "phone_already_verified" }, 409);
  const task = "Verify ownership of this saved phone number. Ask the recipient to explicitly confirm that they own and control it.";
  const latest = await getLatestVerificationCall(session.sub);
  if (latest && !terminalCallStatuses.has(latest.status)) return c.json({ call: latest, reused: true });
  try {
    const call = await createCalleCall({ task, phone: profile.defaultPhone, userId: session.sub, eventId: `verification:${profile.defaultPhone}:${latest?.id ?? "initial"}`, source: "verification" });
    await saveCallTask({ id: call.id, userId: session.sub, task, phone: profile.defaultPhone, source: "verification", status: call.status });
    return c.json({ call }, 201);
  } catch (error) {
    return callErrorResponse(c, error);
  }
});

app.get("/contacts", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ contacts: await listContacts(session.sub) });
});

app.post("/contacts", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const email = typeof body?.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
  if (!name || !summary || !phone) return c.json({ error: "Name, summary, and a valid E.164 phone are required" }, 400);
  if (name.length > 100 || summary.length > 200 || (email?.length ?? 0) > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return c.json({ error: "Contact details are invalid" }, 400);
  try {
    return c.json({ contact: await createContact(session.sub, { name, summary, phone, email }) }, 201);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return c.json({ error: "That phone number already exists" }, 409);
    throw error;
  }
});

app.post("/tasks", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const gmailConnectionId = typeof body?.gmailConnectionId === "string" ? body.gmailConnectionId.trim() : "";
  const vercelConnectionId = typeof body?.vercelConnectionId === "string" ? body.vercelConnectionId.trim() : "";
  const notionConnectionId = typeof body?.notionConnectionId === "string" ? body.notionConnectionId.trim() : "";
  const integrationConnectionId = typeof body?.integrationConnectionId === "string" ? body.integrationConnectionId.trim() : "";
  const executionMode = body?.executionMode === "approval" ? "approval" : "automatic";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const delivery = taskDelivery(body?.delivery);
  const selectedSources = Array.isArray(body?.selectedSources) ? body.selectedSources.filter((item: unknown): item is string => typeof item === "string") : [];
  if (!requestId || requestId.length > 180 || !prompt || prompt.length > 4000 || name.length > 120) return c.json({ error: "requestId, an optional name up to 120 characters, and a prompt up to 4000 characters are required" }, 400);
  if (!delivery) return c.json({ error: "delivery settings are invalid" }, 400);
  const requestedSources = [...new Set(selectedSources.map((source: string) => sourceAliases[source.toLowerCase()]).filter((source: Source | undefined): source is Source => Boolean(source)))];
  if (requestedSources.length > 1) return c.json({ error: "Create one source trigger per flow" }, 400);
  const source = requestedSources[0] ?? inferSource(prompt);
  const existing = await findTaskByRequest(session.sub, requestId);
  if (existing) return existing.status === "needs_clarification"
    ? c.json({ status: "needs_clarification", taskId: existing.id, question: existing.clarificationQuestion })
    : c.json({ status: existing.status, task: existing });
  if (executionMode === "automatic") {
    const profile = await getProfile(session.sub);
    const missing = [
      ...(!profile?.defaultPhone ? ["phone"] : []),
      ...(!profile?.outboundCallConsentAt ? ["consent"] : []),
      ...(!profile?.phoneVerifiedAt ? ["verified"] : []),
    ];
    if (missing.length) return c.json({ status: "onboarding_required", missing }, 409);
  }
  const capacity = await taskCreationCapacity(session.sub);
  if (capacity.active >= taskActiveLimit) return c.json({ error: "Archive an existing trigger before creating another" }, 429);
  if (capacity.recent >= taskHourlyLimit) return c.json({ error: "Task creation is limited to 20 per hour" }, 429);
  if (source === "india" && !process.env.TWELVE_DATA_API_KEY?.trim()) return c.json({ error: "Indian stock triggers are not configured" }, 503);
  if (source === "weather" || source === "sec" || source === "usgs" || source === "nasa" || source === "fx" || source === "india") {
    const task = await createTask({
      id: randomUUID(), userId: session.sub, requestId, prompt, name: name || undefined, status: "creating", parserModel: "pending", executionMode, delivery,
    });
    if (!task) throw new Error("Task creation did not return a row");
    return c.json({ status: task.status, task }, 202);
  }
  const sourceConnections = source === "gmail"
    ? (await listGmailConnections(session.sub)).filter((connection) => connection.status === "connected")
    : source === "vercel"
      ? (await listVercelConnections(session.sub)).filter((connection) => connection.status === "connected")
      : source === "notion"
        ? (await listNotionConnections(session.sub)).filter((connection) => connection.status === "connected")
        : (await listIntegrationConnections(session.sub)).filter((connection) => connection.status === "connected" && connection.provider === source);
  if (!sourceConnections.length) return c.json({ status: "connection_required", connection: source }, 409);
  const requestedConnectionId = source === "gmail" ? gmailConnectionId : source === "vercel" ? vercelConnectionId : source === "notion" ? notionConnectionId : integrationConnectionId;
  const connection = requestedConnectionId
    ? sourceConnections.find((item) => item.id === requestedConnectionId)
    : sourceConnections.length === 1 ? sourceConnections[0] : null;
  if (!connection) return c.json({
    status: "connection_selection_required",
    connection: source,
    connections: sourceConnections.map((item) => ({
      id: item.id,
      email: "gmailAddress" in item ? item.gmailAddress : undefined,
      name: "accountName" in item ? item.accountName : "workspaceName" in item ? item.workspaceName : undefined,
      slug: "accountSlug" in item ? item.accountSlug : undefined,
      pages: "workspaceName" in item ? item.pages : undefined,
      label: "provider" in item ? item.label : undefined,
    })),
  }, 409);

  const task = await createTask({
    id: randomUUID(), userId: session.sub, requestId, prompt, name: name || undefined, status: "creating", parserModel: "pending", executionMode, delivery,
    ...(source === "gmail" ? { gmailConnectionId: connection.id } : source === "vercel" ? { vercelConnectionId: connection.id } : source === "notion" ? { notionConnectionId: connection.id } : { integrationConnectionId: connection.id }),
  });
  if (!task) throw new Error("Task creation did not return a row");
  return c.json({ status: task.status, task }, 202);
});

app.post("/tasks/:id/clarify", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await getTask(session.sub, c.req.param("id"));
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (task.status === "draft" || task.status === "active") return c.json({ status: task.status, task });
  if (task.status !== "needs_clarification") return c.json({ error: "Task is not awaiting clarification" }, 409);
  const body = await c.req.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!requestId || !answer || answer.length > 1000) return c.json({ error: "requestId and an answer up to 1000 characters are required" }, 400);
  const phone = normalizePhone(answer);
  const question = task.clarificationQuestion ?? "";
  const mention = task.originalPrompt.match(/@([^,]+?)(?:\s+when|\s+if|$)/i)?.[1]?.trim().toLowerCase();
  if (phone && /phone|number/i.test(question) && !mention) await updateProfile(session.sub, { defaultPhone: phone });
  if (/email/i.test(question) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer) && mention) {
    const contacts = await listContacts(session.sub);
    const matches = contacts.filter((contact) => contact.name.toLowerCase() === mention || contact.name.toLowerCase().includes(mention));
    if (matches.length === 1) await updateContactEmail(session.sub, matches[0]!.id, answer.toLowerCase());
  }
  const source = task.integrationConnectionId ? inferSource(task.originalPrompt) : task.notionConnectionId ? "notion" : task.vercelConnectionId ? "vercel" : task.gmailConnectionId ? "gmail" : inferSource(task.originalPrompt);
  if ((source === "gmail" || source === "vercel" || source === "notion" || source === "github" || source === "stripe" || source === "google_calendar" || source === "n8n") && !task.gmailConnectionId && !task.vercelConnectionId && !task.notionConnectionId && !task.integrationConnectionId) {
    return c.json({ status: "connection_required", connection: source }, 409);
  }
  const prompt = `${task.originalPrompt}\nClarification answer: ${answer}`;
  try {
    const connections = { gmailConnectionId: task.gmailConnectionId, vercelConnectionId: task.vercelConnectionId, notionConnectionId: task.notionConnectionId, integrationConnectionId: task.integrationConnectionId };
    const { context, result, model } = await parseWithContext(session, prompt, connections, task.executionMode);
    if (result.status === "needs_clarification") {
      await updateTaskClarification(session.sub, task.id, result.question, context, model);
      return c.json({ status: "needs_clarification", taskId: task.id, question: result.question });
    }
    const resolved = await resolveTaskClarification({ id: task.id, userId: session.sub, ...connections, prompt, trigger: result.trigger, action: result.action, parserModel: model });
    return c.json({ status: "draft", task: resolved });
  } catch (error) {
    if (error instanceof TaskParserError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

app.get("/tasks", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const statuses = (c.req.queries("status") ?? []).flatMap((value) => value.split(",")).filter((value): value is Task["status"] => taskStatuses.includes(value as Task["status"]));
  const search = c.req.query("search")?.trim().slice(0, 200);
  return c.json({ tasks: await listTasks(session.sub, { status: statuses.length ? statuses : undefined, search }) });
});
app.get("/tasks/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await getTask(session.sub, c.req.param("id"));
  return task ? c.json({ task }) : c.json({ error: "Task not found" }, 404);
});
app.patch("/tasks/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (body?.status !== undefined) {
    if (!['active', 'paused', 'archived'].includes(body.status)) return c.json({ error: "status must be active, paused, or archived" }, 400);
    const task = await updateTaskStatus(session.sub, c.req.param("id"), body.status);
    return task ? c.json({ task }) : c.json({ error: "Task not found or cannot change status" }, 404);
  }
  const update: { name?: string; trigger?: TaskTrigger; action?: TaskAction; executionMode?: "automatic" | "approval"; delivery?: TaskDelivery } = {};
  if (body?.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) return c.json({ error: "name must contain 1 to 120 characters" }, 400);
    update.name = body.name.trim();
  }
  if (body?.trigger !== undefined) {
    const trigger = taskTrigger(body.trigger);
    if (!trigger) return c.json({ error: "trigger is invalid" }, 400);
    update.trigger = trigger;
  }
  if (body?.action !== undefined) {
    const action = taskAction(body.action);
    if (!action) return c.json({ error: "action is invalid" }, 400);
    update.action = action;
  }
  if (body?.executionMode !== undefined) {
    if (body.executionMode !== "automatic" && body.executionMode !== "approval") return c.json({ error: "executionMode must be automatic or approval" }, 400);
    if (body.executionMode === "automatic") {
      const profile = await getProfile(session.sub);
      if (!profile?.defaultPhone || !profile.outboundCallConsentAt || !profile.phoneVerifiedAt) return c.json({ error: "Complete phone, consent, and verification before enabling automatic calls" }, 409);
    }
    update.executionMode = body.executionMode;
  }
  if (body?.delivery !== undefined) {
    const delivery = taskDelivery(body.delivery);
    if (!delivery) return c.json({ error: "delivery settings are invalid" }, 400);
    update.delivery = delivery;
  }
  if (!Object.keys(update).length) return c.json({ error: "At least one editable task field is required" }, 400);
  const task = await updateTask(session.sub, c.req.param("id"), update);
  return task ? c.json({ task }) : c.json({ error: "Task not found" }, 404);
});

app.post("/tasks/:id/duplicate", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await duplicateTask(session.sub, c.req.param("id"), randomUUID(), `duplicate:${randomUUID()}`);
  return task ? c.json({ task }, 201) : c.json({ error: "Task not found" }, 404);
});

app.post("/tasks/:id/retry", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await retryTaskCreation(session.sub, c.req.param("id"));
  return task ? c.json({ task }, 202) : c.json({ error: "Task is not retryable" }, 409);
});

app.post("/tasks/:id/cancel", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await updateTaskStatus(session.sub, c.req.param("id"), "archived");
  return task ? c.json({ task }) : c.json({ error: "Task not found" }, 404);
});

app.post("/tasks/:id/test", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await getTask(session.sub, c.req.param("id"));
  if (!task?.trigger || !task.action) return c.json({ error: "Task preview is incomplete" }, 409);
  return c.json({ test: true, dispatched: false, preview: { source: task.trigger.type, trigger: task.trigger, recipient: { name: task.action.targetName, phone: task.action.phone }, callObjective: task.action.task, executionMode: task.executionMode } });
});

app.delete("/tasks/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (c.req.query("confirm") !== "true") return c.json({ error: "confirm=true is required" }, 400);
  const task = await deleteTask(session.sub, c.req.param("id"));
  return task ? c.body(null, 204) : c.json({ error: "Task not found" }, 404);
});
app.get("/task-runs", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ runs: await listTaskRuns(session.sub) });
});
app.get("/approvals/unread-count", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ count: await unreadApprovalCount(session.sub) });
});
app.post("/approvals/read", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await markApprovalsRead(session.sub);
  return c.body(null, 204);
});
app.post("/task-runs/:id/approval", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (body?.decision !== "approved" && body?.decision !== "rejected") return c.json({ error: "decision must be approved or rejected" }, 400);
  const run = await decideTaskRunApproval(session.sub, c.req.param("id"), body.decision);
  return run ? c.json({ run }) : c.json({ error: "Approval is no longer pending" }, 409);
});

app.get("/connections/integrations", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connections = await listIntegrationConnections(session.sub);
  return c.json({ connections: connections.map(({ id, provider, label, status }) => ({ id, provider, label, status, webhookUrl: provider === "google_calendar" ? undefined : `${new URL(c.req.url).origin}/webhooks/integrations/${id}` })) });
});

app.post("/connections/integrations", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const provider = body?.provider as IntegrationProvider | undefined;
  if (provider !== "github" && provider !== "stripe" && provider !== "n8n") return c.json({ error: "provider must be github, stripe, or n8n" }, 400);
  const suppliedSecret = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (provider === "stripe" && !suppliedSecret.startsWith("whsec_")) return c.json({ error: "Stripe requires its whsec_ endpoint secret" }, 400);
  const secret = suppliedSecret || randomBytes(32).toString("base64url");
  if (secret.length < 16 || secret.length > 500) return c.json({ error: "Webhook secret must contain 16 to 500 characters" }, 400);
  const connection = await saveIntegrationConnection({ id: randomUUID(), userId: session.sub, provider, label: provider === "github" ? "GitHub webhook" : provider === "stripe" ? "Stripe webhook" : "n8n webhook", encryptedCredential: encryptToken(secret), metadata: {}, status: "connected" });
  return c.json({ connection: { id: connection.id, provider, label: connection.label, status: connection.status, webhookUrl: `${new URL(c.req.url).origin}/webhooks/integrations/${connection.id}`, ...(suppliedSecret ? {} : { secret }) } }, 201);
});

app.get("/connections/google-calendar/start", async (c) => {
  const session = await user(c);
  if (!session) return c.redirect(`${webOrigin}/login`);
  requiredEnv("GOOGLE_CLIENT_ID", "GOOGLE_CALENDAR_REDIRECT_URI");
  const state = randomBytes(24).toString("base64url");
  c.header("Set-Cookie", sessionCookie("calendar_oauth_state", state, 600));
  setOAuthReturnTo(c, "calendar_oauth_return_to", c.req.query("returnTo"));
  return c.redirect(buildCalendarOAuthUrl({ clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI!, state }));
});

app.get("/connections/google-calendar/callback", async (c) => {
  const session = await user(c);
  if (!session) return c.text("Unauthorized", 401);
  if (!c.req.query("state") || c.req.query("state") !== cookieValue(c.req.header("Cookie"), "calendar_oauth_state")) return c.text("Invalid OAuth state", 400);
  const code = c.req.query("code");
  if (!code) return c.text("Missing OAuth code", 400);
  requiredEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY");
  const tokens = await exchangeCalendarCode({ code, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI! });
  if (!new Set(tokens.scope?.split(" ") ?? []).has("https://www.googleapis.com/auth/calendar.events.readonly")) return c.text("Google did not grant read-only Calendar access", 400);
  if (!tokens.refresh_token) return c.text("Google did not return a refresh token. Reconnect and grant consent.", 400);
  const email = await getGoogleIdentity(tokens.access_token);
  await saveIntegrationConnection({
    id: randomUUID(), userId: session.sub, provider: "google_calendar", label: email,
    encryptedCredential: encryptToken(tokens.refresh_token),
    metadata: { encryptedAccessToken: encryptToken(tokens.access_token), accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 },
    status: "connected",
  });
  const returnTo = oauthReturnTo(c, "calendar_oauth_return_to", "/connections?google-calendar=connected");
  c.header("Set-Cookie", sessionCookie("calendar_oauth_state", "", 0));
  c.header("Set-Cookie", sessionCookie("calendar_oauth_return_to", "", 0), { append: true });
  return c.redirect(`${webOrigin}${returnTo}`);
});

app.delete("/connections/integrations/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connection = (await listIntegrationConnections(session.sub)).find((item) => item.id === c.req.param("id"));
  if (!connection) return c.json({ error: "Connection not found" }, 404);
  await disconnectIntegration(connection.id);
  return c.json({ ok: true });
});

app.get("/connections/gmail", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connections = await listGmailConnections(session.sub);
  return c.json({ connections: connections.map(({ id, status, gmailAddress, watchExpiration }) => ({ id, status, email: gmailAddress, watchExpiration })) });
});

app.get("/connections/gmail/start", async (c) => {
  const session = await user(c);
  if (!session) return c.redirect(`${webOrigin}/login`);
  requiredEnv("GOOGLE_CLIENT_ID", "GMAIL_REDIRECT_URI");
  const state = randomBytes(24).toString("base64url");
  c.header("Set-Cookie", sessionCookie("gmail_oauth_state", state, 600));
  setOAuthReturnTo(c, "gmail_oauth_return_to", c.req.query("returnTo"));
  return c.redirect(buildGmailOAuthUrl({ clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri: process.env.GMAIL_REDIRECT_URI!, state }));
});

app.get("/connections/gmail/callback", async (c) => {
  const session = await user(c);
  if (!session) return c.text("Unauthorized", 401);
  const state = c.req.query("state");
  if (!state || state !== cookieValue(c.req.header("Cookie"), "gmail_oauth_state")) return c.text("Invalid OAuth state", 400);
  const code = c.req.query("code");
  if (!code) return c.text("Missing OAuth code", 400);
  requiredEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY", "GOOGLE_PUBSUB_TOPIC");
  const tokens = await exchangeGmailCode({ code, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, redirectUri: process.env.GMAIL_REDIRECT_URI! });
  const scopes = new Set(tokens.scope?.split(" ") ?? []);
  if (!GMAIL_SCOPES.every((scope) => scopes.has(scope))) return c.text("Google did not grant the required Gmail scopes", 400);
  const profile = await getGmailProfile(tokens.access_token);
  const existing = (await listGmailConnections(session.sub)).find((connection) => connection.gmailAddress.toLowerCase() === profile.emailAddress.toLowerCase());
  const refreshToken = tokens.refresh_token ?? (existing?.encryptedRefreshToken ? decryptToken(existing.encryptedRefreshToken) : null);
  if (!refreshToken) return c.text("Google did not return a refresh token. Reconnect and grant consent.", 400);
  const [watch, labelMap] = await Promise.all([watchInbox(tokens.access_token, process.env.GOOGLE_PUBSUB_TOPIC!), listGmailLabels(tokens.access_token)]);
  await saveGmailConnection({ id: existing?.id ?? randomUUID(), userId: session.sub, gmailAddress: profile.emailAddress, encryptedRefreshToken: encryptToken(refreshToken), grantedScopes: [...scopes], labelMap, status: "connected", historyId: watch.historyId, watchExpiration: new Date(Number(watch.expiration)) });
  const returnTo = oauthReturnTo(c, "gmail_oauth_return_to", "/connections?gmail=connected");
  c.header("Set-Cookie", sessionCookie("gmail_oauth_state", "", 0));
  c.header("Set-Cookie", sessionCookie("gmail_oauth_return_to", "", 0), { append: true });
  return c.redirect(`${webOrigin}${returnTo}`);
});

app.delete("/connections/gmail/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connection = await getGmailConnection(session.sub, c.req.param("id"));
  if (!connection) return c.json({ error: "Gmail connection not found" }, 404);
  let warning: string | undefined;
  if (connection.encryptedRefreshToken) {
    const response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decryptToken(connection.encryptedRefreshToken) }) });
    if (!response.ok) warning = "The local connection was removed, but Google token revocation could not be confirmed.";
  }
  await disconnectGmail(connection.id);
  return c.json({ ok: true, warning });
});

app.get("/connections/vercel", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connections = await listVercelConnections(session.sub);
  return c.json({ connections: connections.map(({ id, status, accountName, accountSlug, projects }) => ({ id, status, name: accountName, slug: accountSlug, projects })) });
});

app.get("/connections/vercel/start", async (c) => {
  const session = await user(c);
  if (!session) return c.redirect(`${webOrigin}/login`);
  requiredEnv("VERCEL_INTEGRATION_SLUG", "VERCEL_CLIENT_ID", "VERCEL_REDIRECT_URI");
  const state = randomBytes(24).toString("base64url");
  c.header("Set-Cookie", sessionCookie("vercel_oauth_state", state, 600));
  setOAuthReturnTo(c, "vercel_oauth_return_to", c.req.query("returnTo"));
  return c.redirect(buildVercelInstallUrl(process.env.VERCEL_INTEGRATION_SLUG!, state));
});

app.get("/connections/vercel/callback", async (c) => {
  const session = await user(c);
  if (!session) return c.text("Unauthorized", 401);
  const state = c.req.query("state");
  if (!state || state !== cookieValue(c.req.header("Cookie"), "vercel_oauth_state")) return c.text("Invalid OAuth state", 400);
  const code = c.req.query("code");
  if (!code) return c.text("Missing OAuth code", 400);
  requiredEnv("VERCEL_CLIENT_ID", "VERCEL_CLIENT_SECRET", "VERCEL_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY");
  const token = await exchangeVercelCode({
    code,
    clientId: process.env.VERCEL_CLIENT_ID!,
    clientSecret: process.env.VERCEL_CLIENT_SECRET!,
    redirectUri: process.env.VERCEL_REDIRECT_URI!,
  });
  const [account, projects] = await Promise.all([
    getVercelAccount(token.access_token, token.user_id, token.team_id),
    listVercelProjects(token.access_token, token.team_id),
  ]);
  await saveVercelConnection({
    id: token.installation_id,
    userId: session.sub,
    accountId: account.id,
    accountName: account.name,
    accountSlug: account.slug,
    teamId: token.team_id,
    encryptedAccessToken: encryptToken(token.access_token),
    projects,
    status: "connected",
  });
  const returnTo = oauthReturnTo(c, "vercel_oauth_return_to", "/connections?vercel=connected");
  c.header("Set-Cookie", sessionCookie("vercel_oauth_state", "", 0));
  c.header("Set-Cookie", sessionCookie("vercel_oauth_return_to", "", 0), { append: true });
  return c.redirect(`${webOrigin}${returnTo}`);
});

app.delete("/connections/vercel/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connection = (await listVercelConnections(session.sub)).find((item) => item.id === c.req.param("id"));
  if (!connection) return c.json({ error: "Vercel connection not found" }, 404);
  await disconnectVercel(connection.id);
  return c.json({ ok: true });
});

app.get("/connections/notion", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connections = await listNotionConnections(session.sub);
  return c.json({ connections: connections.map(({ id, status, workspaceName, workspaceIcon, pages }) => ({ id, status, name: workspaceName, icon: workspaceIcon, pages })) });
});

app.get("/connections/notion/start", async (c) => {
  const session = await user(c);
  if (!session) return c.redirect(`${webOrigin}/login`);
  requiredEnv("NOTION_CLIENT_ID", "NOTION_REDIRECT_URI");
  const state = randomBytes(24).toString("base64url");
  c.header("Set-Cookie", sessionCookie("notion_oauth_state", state, 600));
  setOAuthReturnTo(c, "notion_oauth_return_to", c.req.query("returnTo"));
  return c.redirect(buildNotionOAuthUrl({ clientId: process.env.NOTION_CLIENT_ID!, redirectUri: process.env.NOTION_REDIRECT_URI!, state }));
});

app.get("/connections/notion/callback", async (c) => {
  const session = await user(c);
  if (!session) return c.text("Unauthorized", 401);
  const state = c.req.query("state");
  if (!state || state !== cookieValue(c.req.header("Cookie"), "notion_oauth_state")) return c.text("Invalid OAuth state", 400);
  const code = c.req.query("code");
  if (!code) return c.text("Missing OAuth code", 400);
  requiredEnv("NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY");
  const token = await exchangeNotionCode({
    code,
    clientId: process.env.NOTION_CLIENT_ID!,
    clientSecret: process.env.NOTION_CLIENT_SECRET!,
    redirectUri: process.env.NOTION_REDIRECT_URI!,
  });
  const existing = (await listNotionConnections(session.sub)).find((connection) => connection.workspaceId === token.workspace_id);
  const refreshToken = token.refresh_token ?? (existing?.encryptedRefreshToken ? decryptToken(existing.encryptedRefreshToken) : null);
  if (!refreshToken) return c.text("Notion did not return a refresh token. Reconnect the workspace.", 400);
  const pages = await listNotionPages(token.access_token);
  await saveNotionConnection({
    id: existing?.id ?? token.bot_id,
    userId: session.sub,
    workspaceId: token.workspace_id,
    workspaceName: token.workspace_name ?? "Notion workspace",
    workspaceIcon: token.workspace_icon,
    encryptedAccessToken: encryptToken(token.access_token),
    encryptedRefreshToken: encryptToken(refreshToken),
    pages: pages.map(({ id, title, url }) => ({ id, title, url })),
    status: "connected",
  });
  const returnTo = oauthReturnTo(c, "notion_oauth_return_to", "/connections?notion=connected");
  c.header("Set-Cookie", sessionCookie("notion_oauth_state", "", 0));
  c.header("Set-Cookie", sessionCookie("notion_oauth_return_to", "", 0), { append: true });
  return c.redirect(`${webOrigin}${returnTo}`);
});

app.delete("/connections/notion/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const connection = (await listNotionConnections(session.sub)).find((item) => item.id === c.req.param("id"));
  if (!connection) return c.json({ error: "Notion connection not found" }, 404);
  let warning: string | undefined;
  try {
    requiredEnv("NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET");
    await revokeNotionToken(decryptToken(connection.encryptedAccessToken), process.env.NOTION_CLIENT_ID!, process.env.NOTION_CLIENT_SECRET!);
  } catch {
    warning = "The local connection was removed, but Notion token revocation could not be confirmed.";
  }
  await disconnectNotion(connection.id);
  return c.json({ ok: true, warning });
});

app.post("/webhooks/gmail", async (c) => {
  try {
    await verifyPubSubOidc(c.req.header("Authorization"));
  } catch {
    return c.json({ error: "Invalid Pub/Sub identity" }, 401);
  }
  let event;
  try {
    event = decodePubSubPayload(await c.req.json());
  } catch {
    return c.json({ error: "Invalid Pub/Sub payload" }, 400);
  }
  for (const connection of await getGmailConnectionsByAddress(event.emailAddress)) {
    await enqueueGmailNotification({ id: randomUUID(), userId: connection.userId, gmailConnectionId: connection.id, pubsubMessageId: event.messageId, historyId: event.historyId });
  }
  return c.body(null, 204);
});

app.post("/webhooks/integrations/:id", async (c) => {
  const connection = await getIntegrationConnectionById(c.req.param("id"));
  if (!connection || connection.status !== "connected" || connection.provider === "google_calendar") return c.json({ error: "Webhook connection not found" }, 404);
  const rawBody = await c.req.text();
  const secret = decryptToken(connection.encryptedCredential);
  const authorized = connection.provider === "github"
    ? verifyGitHubWebhook(rawBody, c.req.header("X-Hub-Signature-256"), secret)
    : connection.provider === "stripe"
      ? verifyStripeWebhook(rawBody, c.req.header("Stripe-Signature"), secret)
      : equalSecret(c.req.header("X-Kordy-Webhook-Secret") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "", secret);
  if (!authorized) return c.json({ error: "Invalid webhook signature" }, 401);
  try {
    const event = normalizeWebhookEvent(connection.provider, rawBody, c.req.raw.headers);
    await persistIntegrationEvent(connection, event);
    return c.body(null, 204);
  } catch {
    return c.json({ error: "Invalid webhook payload" }, 400);
  }
});

app.get("/calls", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) return c.json({ error: "limit must be between 1 and 100" }, 400);
  const from = c.req.query("from");
  const to = c.req.query("to");
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) return c.json({ error: "from and to must be ISO dates" }, 400);
  const result = await listCallTasks(session.sub, {
    source: c.req.query("source"), triggerId: c.req.query("triggerId"), recipient: c.req.query("recipient"), status: c.req.query("status"), answeredBy: c.req.query("answeredBy"), from, to, cursor: c.req.query("cursor"), limit,
  });
  return c.json(result);
});
app.get("/calls/metrics", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const [metrics, used] = await Promise.all([callMetrics(session.sub), callDispatchUsage(session.sub)]);
  const limit = dailyCallLimit();
  return c.json({ metrics, budget: { used, limit, remaining: Math.max(0, limit - used), windowHours: 24 } });
});
app.get("/calls/export", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const format = c.req.query("format") ?? "json";
  if (format !== "json" && format !== "csv") return c.json({ error: "format must be json or csv" }, 400);
  const filters = { source: c.req.query("source"), triggerId: c.req.query("triggerId"), recipient: c.req.query("recipient"), status: c.req.query("status"), answeredBy: c.req.query("answeredBy"), from: c.req.query("from"), to: c.req.query("to") };
  const calls: Awaited<ReturnType<typeof listCallTasks>>["calls"] = [];
  let cursor: string | undefined;
  do {
    const page = await listCallTasks(session.sub, { ...filters, cursor, limit: 10_000 });
    calls.push(...page.calls);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  if (format === "json") {
    c.header("Content-Disposition", 'attachment; filename="kordy-calls.json"');
    return c.json({ calls });
  }
  const fields = ["id", "taskId", "taskName", "phone", "source", "region", "locale", "status", "answeredBy", "taskRunAttempts", "summary", "failureCode", "failureMessage", "replyStatus", "createdAt", "completedAt"] as const;
  const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(","), ...calls.map((call) => fields.map((field) => cell(call[field])).join(","))].join("\n");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="kordy-calls.csv"');
  return c.body(csv);
});
app.get("/calls/:id", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const call = await getCallTask(session.sub, c.req.param("id"));
  return call ? c.json({ call }) : c.json({ error: "Call not found" }, 404);
});
app.post("/calls/:id/retry-reply", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const call = await retryEmailReply(session.sub, c.req.param("id"));
  return call ? c.json({ call }, 202) : c.json({ error: "Failed reply is not retryable" }, 409);
});
app.post("/calls", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const source = typeof body?.source === "string" && calleSources.includes(body.source as CalleSource) ? body.source as CalleSource : "generic";
  const region = body?.region === undefined || body.region === null ? null : typeof body.region === "string" ? normalizeCallRegion(body.region) : null;
  const locale = body?.locale === undefined || body.locale === null ? null : typeof body.locale === "string" ? normalizeCallLocale(body.locale) : null;
  if (!task || !phone || !eventId) return c.json({ error: "Task, E.164 phone number, and eventId are required" }, 400);
  if (body?.source !== undefined && source === "generic" && body.source !== "generic") return c.json({ error: "source is not supported" }, 400);
  if (source === "verification") return c.json({ error: "Use /onboarding/test-call for phone verification" }, 400);
  if (body?.region !== undefined && body.region !== null && !region) return c.json({ error: "region is not supported" }, 400);
  if (body?.locale !== undefined && body.locale !== null && !locale) return c.json({ error: "locale must be a valid BCP 47 locale" }, 400);
  try {
    const call = await createCalleCall({ task, phone, userId: session.sub, eventId, source, region, locale });
    await saveCallTask({ id: call.id, userId: session.sub, task, phone, source, status: call.status });
    return c.json({ call }, 201);
  } catch (error) {
    return callErrorResponse(c, error);
  }
});

app.post("/webhooks/calle", async (c) => {
  const body = await c.req.json().catch(() => null);
  const eventId = c.req.header("CALL-E-Event-Id");
  const callId = typeof body?.data?.id === "string" ? body.data.id : "";
  if (!eventId || eventId !== body?.id || !/^call_[A-Za-z0-9_-]+$/.test(callId)) return c.json({ error: "Invalid CALL-E event" }, 400);
  try {
    const stored = await getStoredCallTask(callId);
    if (!stored) return c.json({ error: "Unknown CALL-E call" }, 404);
    if (terminalCallStatuses.has(stored.status)) {
      if (stored.source === "verification") {
        const call = await getCalleCall(callId);
        if (call.id !== callId) return c.json({ error: "CALL-E call mismatch" }, 400);
        if (confirmedPhoneOwnership(call)) await markDefaultPhoneVerified(stored.userId, stored.phone);
      }
      return c.json({ ok: true });
    }
    const call = await getCalleCall(callId);
    if (call.id !== callId) return c.json({ error: "CALL-E call mismatch" }, 400);
    const recipientType = answeredBy(call);
    const replyInstruction = call.status === "completed"
      ? confirmedReplyInstruction(call.structured_result, call.completion_confidence, recipientType, call.task_completed)
      : null;
    await updateCallTask({
      id: call.id,
      status: call.status,
      summary: call.summary,
      result: call.structured_result,
      taskCompleted: call.task_completed,
      completionConfidence: call.completion_confidence,
      evidence: call.evidence,
      recipients: call.recipients,
      answeredBy: recipientType,
      failureCode: call.failure_code,
      failureMessage: call.failure_message,
      providerEventId: eventId,
      completedAt: call.completed_at,
      queueEmailReply: Boolean(replyInstruction),
    });
    if (stored.source === "verification" && confirmedPhoneOwnership(call)) {
      await markDefaultPhoneVerified(stored.userId, stored.phone);
    }
    return c.json({ ok: true });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Could not verify the CALL-E event" }, 502);
  }
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  port: Number(process.env.PORT ?? 3007),
  async fetch(request: Request) {
    await databaseReady;
    return app.fetch(request);
  },
};
