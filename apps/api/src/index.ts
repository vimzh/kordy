// Hono API for authentication, source connections, persisted tasks, and provider webhooks.
import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clearSession, cookieValue, currentSession, finishGoogleAuth, sessionCookie, startGoogleAuth, type Session } from "./auth";
import { confirmedReplyInstruction, createCalleCall, getCalleCall, normalizePhone } from "./calle";
import {
  createContact, createTask, decideTaskRunApproval, disconnectGmail, disconnectNotion, disconnectVercel, enqueueGmailNotification, findTaskByRequest, getGmailConnection,
  getGmailConnectionByAddress, getProfile, getTask, getTaskContext, initializeDatabase, listCallTasks, listContacts, queueConfirmedEmailReply,
  listGmailConnections, listNotionConnections, listTaskRuns, listTasks, listVercelConnections, resolveTaskClarification, saveCallTask, saveGmailConnection, saveNotionConnection, saveVercelConnection, updateCallTask,
  updateContactEmail, updateProfile, updateTaskClarification, updateTaskStatus, upsertUser, type TaskAction, type TaskTrigger,
} from "./db";
import {
  GMAIL_SCOPES, buildGmailOAuthUrl, decodePubSubPayload, decryptToken, encryptToken, exchangeGmailCode,
  getGmailProfile, listGmailLabels, verifyPubSubOidc, watchInbox,
} from "./gmail";
import { parseTaskPrompt, TaskParserError, type TaskAgentContext, type TaskParseResult } from "./task-agent";
import { buildVercelInstallUrl, exchangeVercelCode, getVercelAccount, listVercelProjects } from "./vercel";
import { buildNotionOAuthUrl, exchangeNotionCode, listNotionPages, revokeNotionToken } from "./notion";

const app = new Hono();
const webOrigin = new URL(process.env.WEB_URL ?? "http://localhost:3006/home").origin;
const databaseReady = initializeDatabase();

app.use("*", cors({ origin: webOrigin, credentials: true }));

function requiredEnv(...names: string[]) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
}

async function user(c: Parameters<typeof currentSession>[0]) {
  const session = currentSession(c);
  if (session) await upsertUser(session);
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
    contacts: context.contacts.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
  };
}

function publicTaskResult(result: TaskParseResult, context: TaskAgentContext, executionMode: "automatic" | "approval" = "automatic") {
  if (result.status === "needs_clarification") return result;
  const target = result.action.target;
  const contact = target.type === "contact" ? context.contacts.find(({ id }) => id === target.contactId) : null;
  const phone = target.type === "self" ? context.currentUser.defaultPhone : contact?.phone;
  if (!phone || !normalizePhone(phone)) return { status: "needs_clarification" as const, question: "What E.164 phone number should Kordy call?" };
  const trigger: TaskTrigger = result.trigger.source === "gmail" ? {
    type: "email.received",
    match: "and",
    senders: result.trigger.rules.senders.map((value) => value.toLowerCase()),
    subjectKeywords: result.trigger.rules.subjectKeywords,
    bodyKeywords: result.trigger.rules.bodyKeywords,
    labels: result.trigger.rules.labels.map((name) => context.gmail.labelIds[name]!),
  } : result.trigger.source === "vercel" ? {
    type: "deployment.failed",
    projectIds: result.trigger.rules.projectIds,
    projectNames: result.trigger.rules.projectNames,
    environments: result.trigger.rules.environments,
  } : {
    type: "notion.page.updated",
    pageIds: result.trigger.rules.pageIds,
    pageTitles: result.trigger.rules.pageTitles,
    keywords: result.trigger.rules.keywords,
  };
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

async function parseWithContext(session: Session, prompt: string, connections: { gmailConnectionId?: string | null; vercelConnectionId?: string | null; notionConnectionId?: string | null }, executionMode: "automatic" | "approval" = "automatic") {
  const context = taskContext(session, await getTaskContext(session.sub, connections));
  const parsed = await parseTaskPrompt(prompt, context);
  return { context, result: publicTaskResult(parsed.result, context, executionMode), model: parsed.model };
}

app.get("/", (c) => c.text("Kordy API"));
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/auth/google", startGoogleAuth);
app.get("/auth/google/callback", finishGoogleAuth);
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
  const phone = body?.defaultPhone === null ? null : typeof body?.defaultPhone === "string" ? normalizePhone(body.defaultPhone) : null;
  if (body?.defaultPhone !== null && !phone) return c.json({ error: "defaultPhone must be a valid E.164 number" }, 400);
  return c.json({ profile: await updateProfile(session.sub, phone) });
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
  const executionMode = body?.executionMode === "approval" ? "approval" : "automatic";
  const selectedSources = Array.isArray(body?.selectedSources) ? body.selectedSources.filter((item: unknown): item is string => typeof item === "string") : [];
  if (!requestId || requestId.length > 180 || !prompt || prompt.length > 4000) return c.json({ error: "requestId and a prompt up to 4000 characters are required" }, 400);
  const requestedSources = [...new Set(selectedSources.map((source: string) => source.toLowerCase()).filter((source: string) => source === "gmail" || source === "vercel" || source === "notion"))];
  if (requestedSources.length > 1) return c.json({ error: "Create one source trigger per flow" }, 400);
  const source = requestedSources[0] ?? (/\bnotion\b/i.test(prompt) ? "notion" : /\b(?:vercel|deploy(?:ment)?|build)\b/i.test(prompt) ? "vercel" : "gmail");
  const existing = await findTaskByRequest(session.sub, requestId);
  if (existing) return existing.status === "needs_clarification"
    ? c.json({ status: "needs_clarification", taskId: existing.id, question: existing.clarificationQuestion })
    : c.json({ status: existing.status, task: existing });
  const sourceConnections = source === "gmail"
    ? (await listGmailConnections(session.sub)).filter((connection) => connection.status === "connected")
    : source === "vercel"
      ? (await listVercelConnections(session.sub)).filter((connection) => connection.status === "connected")
      : (await listNotionConnections(session.sub)).filter((connection) => connection.status === "connected");
  if (!sourceConnections.length) return c.json({ status: "connection_required", connection: source }, 409);
  const requestedConnectionId = source === "gmail" ? gmailConnectionId : source === "vercel" ? vercelConnectionId : notionConnectionId;
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
    })),
  }, 409);

  const task = await createTask({
    id: randomUUID(), userId: session.sub, requestId, prompt, status: "creating", parserModel: "pending", executionMode,
    ...(source === "gmail" ? { gmailConnectionId: connection.id } : source === "vercel" ? { vercelConnectionId: connection.id } : { notionConnectionId: connection.id }),
  });
  if (!task) throw new Error("Task creation did not return a row");
  return c.json({ status: task.status, task }, 202);
});

app.post("/tasks/:id/clarify", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const task = await getTask(session.sub, c.req.param("id"));
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (task.status === "active") return c.json({ status: "active", task });
  if (task.status !== "needs_clarification") return c.json({ error: "Task is not awaiting clarification" }, 409);
  const body = await c.req.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!requestId || !answer || answer.length > 1000) return c.json({ error: "requestId and an answer up to 1000 characters are required" }, 400);
  const phone = normalizePhone(answer);
  const question = task.clarificationQuestion ?? "";
  const mention = task.originalPrompt.match(/@([^,]+?)(?:\s+when|\s+if|$)/i)?.[1]?.trim().toLowerCase();
  if (phone && /phone|number/i.test(question) && !mention) await updateProfile(session.sub, phone);
  if (/email/i.test(question) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer) && mention) {
    const contacts = await listContacts(session.sub);
    const matches = contacts.filter((contact) => contact.name.toLowerCase() === mention || contact.name.toLowerCase().includes(mention));
    if (matches.length === 1) await updateContactEmail(session.sub, matches[0]!.id, answer.toLowerCase());
  }
  const source = task.notionConnectionId ? "notion" : task.vercelConnectionId ? "vercel" : "gmail";
  if (!task.gmailConnectionId && !task.vercelConnectionId && !task.notionConnectionId) return c.json({ status: "connection_required", connection: source }, 409);
  const prompt = `${task.originalPrompt}\nClarification answer: ${answer}`;
  try {
    const connections = { gmailConnectionId: task.gmailConnectionId, vercelConnectionId: task.vercelConnectionId, notionConnectionId: task.notionConnectionId };
    const { context, result, model } = await parseWithContext(session, prompt, connections, task.action?.executionMode ?? "automatic");
    if (result.status === "needs_clarification") {
      await updateTaskClarification(session.sub, task.id, result.question, context, model);
      return c.json({ status: "needs_clarification", taskId: task.id, question: result.question });
    }
    const resolved = await resolveTaskClarification({ id: task.id, userId: session.sub, ...connections, prompt, trigger: result.trigger, action: result.action, parserModel: model });
    return c.json({ status: "active", task: resolved });
  } catch (error) {
    if (error instanceof TaskParserError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

app.get("/tasks", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ tasks: await listTasks(session.sub) });
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
  if (!['active', 'paused', 'archived'].includes(body?.status)) return c.json({ error: "status must be active, paused, or archived" }, 400);
  const task = await updateTaskStatus(session.sub, c.req.param("id"), body.status);
  return task ? c.json({ task }) : c.json({ error: "Task not found or cannot change status" }, 404);
});
app.get("/task-runs", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ runs: await listTaskRuns(session.sub) });
});
app.post("/task-runs/:id/approval", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (body?.decision !== "approved" && body?.decision !== "rejected") return c.json({ error: "decision must be approved or rejected" }, 400);
  const run = await decideTaskRunApproval(session.sub, c.req.param("id"), body.decision);
  return run ? c.json({ run }) : c.json({ error: "Approval is no longer pending" }, 409);
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
  c.header("Set-Cookie", sessionCookie("gmail_oauth_state", "", 0));
  return c.redirect(`${webOrigin}/connections?gmail=connected`);
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
  c.header("Set-Cookie", sessionCookie("vercel_oauth_state", "", 0));
  return c.redirect(`${webOrigin}/connections?vercel=connected`);
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
  c.header("Set-Cookie", sessionCookie("notion_oauth_state", "", 0));
  return c.redirect(`${webOrigin}/connections?notion=connected`);
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
  const connection = await getGmailConnectionByAddress(event.emailAddress);
  if (connection) await enqueueGmailNotification({ id: randomUUID(), userId: connection.userId, gmailConnectionId: connection.id, pubsubMessageId: event.messageId, historyId: event.historyId });
  return c.body(null, 204);
});

app.get("/calls", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ calls: await listCallTasks(session.sub) });
});
app.post("/calls", async (c) => {
  const session = await user(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!task || !phone || !eventId) return c.json({ error: "Task, E.164 phone number, and eventId are required" }, 400);
  try {
    const call = await createCalleCall({ task, phone, userId: session.sub, eventId });
    await saveCallTask({ id: call.id, userId: session.sub, task, phone, status: call.status });
    return c.json({ call }, 201);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Could not create the CALL-E call" }, 502);
  }
});

app.post("/webhooks/calle", async (c) => {
  const body = await c.req.json().catch(() => null);
  const eventId = c.req.header("CALL-E-Event-Id");
  const callId = typeof body?.data?.id === "string" ? body.data.id : "";
  if (!eventId || eventId !== body?.id || !/^call_[A-Za-z0-9_-]+$/.test(callId)) return c.json({ error: "Invalid CALL-E event" }, 400);
  try {
    const call = await getCalleCall(callId);
    if (call.id !== callId) return c.json({ error: "CALL-E call mismatch" }, 400);
    await updateCallTask({ id: call.id, status: call.status, summary: call.summary, result: call.structured_result });
    if (call.status === "completed" && confirmedReplyInstruction(call.structured_result)) await queueConfirmedEmailReply(call.id);
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
