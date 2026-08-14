// Hono API for authentication, persisted tasks, Gmail connections, Pub/Sub delivery, and CALL-E webhooks.
import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clearSession, cookieValue, currentSession, finishGoogleAuth, sessionCookie, startGoogleAuth, type Session } from "./auth";
import { confirmedReplyInstruction, createCalleCall, getCalleCall, normalizePhone } from "./calle";
import {
  createContact, createTask, decideTaskRunApproval, disconnectGmail, enqueueGmailNotification, findTaskByRequest, getGmailConnection,
  getGmailConnectionByAddress, getProfile, getTask, getTaskContext, initializeDatabase, listCallTasks, listContacts, queueConfirmedEmailReply,
  listGmailConnections, listTaskRuns, listTasks, resolveTaskClarification, saveCallTask, saveGmailConnection, updateCallTask,
  updateContactEmail, updateProfile, updateTaskClarification, updateTaskStatus, upsertUser, type TaskAction, type TaskTrigger,
} from "./db";
import {
  GMAIL_SCOPES, buildGmailOAuthUrl, decodePubSubPayload, decryptToken, encryptToken, exchangeGmailCode,
  getGmailProfile, listGmailLabels, verifyPubSubOidc, watchInbox,
} from "./gmail";
import { parseTaskPrompt, TaskParserError, type TaskAgentContext, type TaskParseResult } from "./task-agent";

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
    contacts: context.contacts.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
  };
}

function publicTaskResult(result: TaskParseResult, context: TaskAgentContext, executionMode: "automatic" | "approval" = "automatic") {
  if (result.status === "needs_clarification") return result;
  const target = result.action.target;
  const contact = target.type === "contact" ? context.contacts.find(({ id }) => id === target.contactId) : null;
  const phone = target.type === "self" ? context.currentUser.defaultPhone : contact?.phone;
  if (!phone || !normalizePhone(phone)) return { status: "needs_clarification" as const, question: "What E.164 phone number should Kordy call?" };
  const trigger: TaskTrigger = {
    type: "email.received",
    match: "and",
    senders: result.trigger.rules.senders.map((value) => value.toLowerCase()),
    subjectKeywords: result.trigger.rules.subjectKeywords,
    bodyKeywords: result.trigger.rules.bodyKeywords,
    labels: result.trigger.rules.labels.map((name) => context.gmail.labelIds[name]!),
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

async function parseWithContext(session: Session, prompt: string, gmailConnectionId: string, executionMode: "automatic" | "approval" = "automatic") {
  const context = taskContext(session, await getTaskContext(session.sub, gmailConnectionId));
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
  const executionMode = body?.executionMode === "approval" ? "approval" : "automatic";
  const selectedSources = Array.isArray(body?.selectedSources) ? body.selectedSources.filter((item: unknown): item is string => typeof item === "string") : [];
  if (!requestId || requestId.length > 180 || !prompt || prompt.length > 4000) return c.json({ error: "requestId and a prompt up to 4000 characters are required" }, 400);
  if (selectedSources.some((source: string) => source.toLowerCase() !== "gmail")) return c.json({ error: "Only Gmail sources are supported in this milestone" }, 400);
  const existing = await findTaskByRequest(session.sub, requestId);
  if (existing) return existing.status === "needs_clarification"
    ? c.json({ status: "needs_clarification", taskId: existing.id, question: existing.clarificationQuestion })
    : c.json({ status: existing.status, task: existing });
  const gmailConnections = (await listGmailConnections(session.sub)).filter((connection) => connection.status === "connected");
  if (!gmailConnections.length) return c.json({ status: "connection_required", connection: "gmail" }, 409);
  const gmail = gmailConnectionId ? gmailConnections.find((connection) => connection.id === gmailConnectionId) : gmailConnections.length === 1 ? gmailConnections[0] : null;
  if (!gmail) return c.json({
    status: "connection_selection_required",
    connection: "gmail",
    connections: gmailConnections.map(({ id, gmailAddress }) => ({ id, email: gmailAddress })),
  }, 409);

  const task = await createTask({ id: randomUUID(), userId: session.sub, requestId, prompt, status: "creating", gmailConnectionId: gmail.id, parserModel: "pending", executionMode });
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
  if (!task.gmailConnectionId) return c.json({ status: "connection_required", connection: "gmail" }, 409);
  const prompt = `${task.originalPrompt}\nClarification answer: ${answer}`;
  try {
    const { context, result, model } = await parseWithContext(session, prompt, task.gmailConnectionId, task.action?.executionMode ?? "automatic");
    if (result.status === "needs_clarification") {
      await updateTaskClarification(session.sub, task.id, result.question, context, model);
      return c.json({ status: "needs_clarification", taskId: task.id, question: result.question });
    }
    const resolved = await resolveTaskClarification({ id: task.id, userId: session.sub, gmailConnectionId: task.gmailConnectionId, prompt, trigger: result.trigger, action: result.action, parserModel: model });
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
