// PostgreSQL persistence for users, Gmail task definitions, durable events, runs, and calls.
import { SQL } from "bun";
import { and, desc, eq, ilike, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { alias } from "drizzle-orm/pg-core";
import { callTasks, contacts, gmailConnections, sourceEvents, taskRuns, tasks, users } from "./schema";

export type Contact = {
  id: string;
  name: string;
  summary: string;
  phone: string;
  email: string | null;
  createdAt: string;
};

export type TaskTrigger = {
  type: "email.received";
  match: "and";
  senders: string[];
  subjectKeywords: string[];
  bodyKeywords: string[];
  labels: string[];
};

export type TaskAction = {
  type: "calle.call";
  targetType: "self" | "contact";
  targetId?: string;
  targetName: string;
  phone: string;
  task: string;
  executionMode?: "automatic" | "approval";
};

export type Task = {
  id: string;
  userId: string;
  gmailConnectionId: string | null;
  originalPrompt: string;
  status: "creating" | "parsing" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed";
  trigger: TaskTrigger | null;
  action: TaskAction | null;
  clarificationQuestion: string | null;
  clarificationContext: unknown;
  parserModel: string;
  executionMode: "automatic" | "approval";
  createdAt: string;
  updatedAt: string;
};

export type GmailConnection = {
  id: string;
  userId: string;
  gmailAddress: string;
  encryptedRefreshToken: string;
  grantedScopes: string[];
  labelMap: Record<string, string>;
  status: "connected" | "needs_reconnect" | "disconnected";
  historyId: string | null;
  watchExpiration: string | null;
  lastSyncedAt: string | null;
};

export type CallTask = {
  id: string;
  task: string;
  phone: string;
  status: string;
  summary: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL");
const client = new SQL({ url: databaseUrl, max: 2 });
export const db = drizzle({ client });

const demoContacts = [
  ["Aarav Mehta", "Founder building finance tools for independent retailers.", "+919876543210", "aarav@example.com"],
  ["Maya Chen", "Product lead evaluating workflow automation for her operations team.", "+14155550136", "maya@example.com"],
  ["Noah Williams", "Angel investor focused on early-stage developer infrastructure.", "+442079460182", "noah@example.com"],
  ["Sofia Ramirez", "Operations director modernising customer support workflows.", "+12025550101", "sofia@example.com"],
  ["Ethan Brooks", "Engineering manager responsible for platform reliability.", "+12025550102", "ethan@example.com"],
  ["Priya Shah", "Growth lead running partnerships for a B2B software company.", "+12025550103", "priya@example.com"],
  ["Lucas Martin", "Independent consultant helping startups improve sales operations.", "+12025550104", "lucas@example.com"],
  ["Amara Okafor", "Community founder organising events for product builders.", "+12025550105", "amara@example.com"],
  ["Daniel Kim", "Security lead monitoring infrastructure and incident response.", "+12025550106", "daniel@example.com"],
  ["Elena Petrova", "Customer success manager overseeing strategic accounts.", "+12025550107", "elena@example.com"],
] as const;

export async function initializeDatabase() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      default_phone VARCHAR(16),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      summary VARCHAR(200) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;
    CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_phone_key ON contacts(user_id, phone);

    CREATE TABLE IF NOT EXISTS gmail_connections (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      gmail_address TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL,
      granted_scopes TEXT[] NOT NULL DEFAULT '{}',
      gmail_labels JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reconnect', 'disconnected')),
      history_id TEXT,
      watch_expiration TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS gmail_labels JSONB NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      original_prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('creating', 'parsing', 'active', 'needs_clarification', 'paused', 'archived', 'parse_failed')),
      schema_version INTEGER NOT NULL DEFAULT 1,
      gmail_connection_id TEXT REFERENCES gmail_connections(user_id) ON DELETE SET NULL,
      trigger JSONB,
      action JSONB,
      clarification_question TEXT,
      clarification_context JSONB,
      parser_model TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'automatic',
      activation_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, request_id)
    );
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'automatic';
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('creating', 'parsing', 'active', 'needs_clarification', 'paused', 'archived', 'parse_failed'));

    CREATE TABLE IF NOT EXISTS source_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gmail_connection_id TEXT NOT NULL REFERENCES gmail_connections(user_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('gmail.notification', 'gmail.message')),
      pubsub_message_id TEXT,
      gmail_message_id TEXT,
      gmail_thread_id TEXT,
      history_id TEXT,
      dedup_key TEXT NOT NULL UNIQUE,
      headers JSONB,
      snippet TEXT,
      occurred_at TIMESTAMPTZ,
      processing_state TEXT NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ DEFAULT NOW(),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS source_events_queue_idx ON source_events(processing_state, available_at);

    DO $$
    DECLARE r RECORD;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gmail_connections' AND column_name = 'id'
      ) THEN
        ALTER TABLE gmail_connections ADD COLUMN id TEXT;
        UPDATE gmail_connections SET id = user_id WHERE id IS NULL;
        ALTER TABLE gmail_connections ALTER COLUMN id SET NOT NULL;
        FOR r IN SELECT conrelid::regclass AS table_name, conname
          FROM pg_constraint WHERE contype = 'f' AND confrelid = 'gmail_connections'::regclass
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
        END LOOP;
        ALTER TABLE gmail_connections DROP CONSTRAINT gmail_connections_pkey;
        ALTER TABLE gmail_connections ADD CONSTRAINT gmail_connections_pkey PRIMARY KEY (id);
        ALTER TABLE tasks ADD CONSTRAINT tasks_gmail_connection_id_fkey
          FOREIGN KEY (gmail_connection_id) REFERENCES gmail_connections(id) ON DELETE SET NULL;
        ALTER TABLE source_events ADD CONSTRAINT source_events_gmail_connection_id_fkey
          FOREIGN KEY (gmail_connection_id) REFERENCES gmail_connections(id) ON DELETE CASCADE;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS gmail_connections_user_address_key ON gmail_connections(user_id, gmail_address);

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      source_event_id TEXT NOT NULL REFERENCES source_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'calling', 'completed', 'failed', 'not_matched')),
      matching_evidence JSONB,
      call_task_id TEXT,
      result JSONB,
      error TEXT,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'not_required',
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(task_id, source_event_id)
    );
    ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'not_required';
    ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE task_runs ALTER COLUMN available_at DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS call_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task TEXT NOT NULL,
      phone VARCHAR(16) NOT NULL,
      status VARCHAR(40) NOT NULL,
      summary TEXT,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS task_run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS reply_status VARCHAR(20) NOT NULL DEFAULT 'not_requested';
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS reply_message_id TEXT;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS reply_error TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS call_tasks_run_key ON call_tasks(task_run_id) WHERE task_run_id IS NOT NULL;
  `));
}

export async function upsertUser(user: { sub: string; email?: string; name?: string; picture?: string }) {
  if (!user.email) throw new Error("Google profile did not include an email");
  await db.insert(users).values({ id: user.sub, email: user.email, name: user.name, picture: user.picture })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, name: user.name, picture: user.picture, updatedAt: sql`now()` },
    });
  const hasContacts = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, user.sub)).limit(1);
  if (hasContacts.length) return;
  await db.insert(contacts).values(demoContacts.map(([name, summary, phone, email]) => ({
    userId: user.sub, name, summary, phone, email,
  }))).onConflictDoNothing({ target: [contacts.userId, contacts.phone] });
}

export async function getProfile(userId: string) {
  const [profile] = await db.select({
    email: users.email, name: users.name, picture: users.picture, defaultPhone: users.defaultPhone,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return profile ?? null;
}

export async function updateProfile(userId: string, defaultPhone: string | null) {
  const [profile] = await db.update(users).set({ defaultPhone, updatedAt: sql`now()` }).where(eq(users.id, userId)).returning({
    email: users.email, name: users.name, picture: users.picture, defaultPhone: users.defaultPhone,
  });
  return profile ?? null;
}

export async function listContacts(userId: string) {
  const rows = await db.select({
    id: contacts.id, name: contacts.name, summary: contacts.summary, phone: contacts.phone,
    email: contacts.email, createdAt: contacts.createdAt,
  }).from(contacts).where(eq(contacts.userId, userId)).orderBy(desc(contacts.createdAt), desc(contacts.id));
  return rows.map((row) => ({ ...row, id: String(row.id) }));
}

export async function createContact(userId: string, contact: Pick<Contact, "name" | "summary" | "phone" | "email">) {
  const [created] = await db.insert(contacts).values({ userId, ...contact }).returning({
    id: contacts.id, name: contacts.name, summary: contacts.summary, phone: contacts.phone,
    email: contacts.email, createdAt: contacts.createdAt,
  });
  return created && { ...created, id: String(created.id) };
}

export async function updateContactEmail(userId: string, id: string, email: string) {
  const [contact] = await db.update(contacts).set({ email }).where(and(eq(contacts.id, BigInt(id)), eq(contacts.userId, userId))).returning({
    id: contacts.id, name: contacts.name, summary: contacts.summary, phone: contacts.phone,
    email: contacts.email, createdAt: contacts.createdAt,
  });
  return contact ? { ...contact, id: String(contact.id) } : null;
}

export async function getTaskContext(userId: string, gmailConnectionId: string) {
  const [profile, gmail, contacts] = await Promise.all([getProfile(userId), getGmailConnection(userId, gmailConnectionId), listContacts(userId)]);
  return { profile, gmail, contacts };
}

export async function findTaskByRequest(userId: string, requestId: string) {
  const [task] = await taskQuery(userId, undefined, requestId);
  return task ?? null;
}

export async function getTask(userId: string, id: string) {
  const [task] = await taskQuery(userId, id);
  return task ?? null;
}

export async function listTasks(userId: string) {
  return taskQuery(userId);
}

export async function listActiveWorkerTasks(gmailConnectionId: string) {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt, trigger: tasks.trigger, action: tasks.action, activationAt: tasks.activationAt,
  }).from(tasks).where(and(eq(tasks.gmailConnectionId, gmailConnectionId), eq(tasks.status, "active")));
  return rows.map(({ id, userId: ownerId, originalPrompt, trigger, action, activationAt }) => {
    const parsedTrigger = trigger as TaskTrigger;
    const parsedAction = action as TaskAction;
    return {
    id,
    userId: ownerId,
    originalPrompt,
    instruction: parsedAction.task,
    phone: parsedAction.phone,
    executionMode: parsedAction.executionMode ?? "automatic",
    activationAt: activationAt ?? undefined,
    senders: parsedTrigger.senders,
    subjectKeywords: parsedTrigger.subjectKeywords,
    bodyKeywords: parsedTrigger.bodyKeywords,
    labels: parsedTrigger.labels,
  }});
}

const taskSelection = {
  id: tasks.id,
  userId: tasks.userId,
  gmailConnectionId: tasks.gmailConnectionId,
  originalPrompt: tasks.originalPrompt,
  status: tasks.status,
  trigger: tasks.trigger,
  action: tasks.action,
  clarificationQuestion: tasks.clarificationQuestion,
  clarificationContext: tasks.clarificationContext,
  parserModel: tasks.parserModel,
  executionMode: tasks.executionMode,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
};

async function taskQuery(userId: string, id?: string, requestId?: string): Promise<Task[]> {
  const filters = [eq(tasks.userId, userId)];
  if (id) filters.push(eq(tasks.id, id));
  if (requestId) filters.push(eq(tasks.requestId, requestId));
  const rows = await db.select(taskSelection).from(tasks).where(and(...filters)).orderBy(desc(tasks.createdAt));
  return rows.map((row) => ({ ...row, trigger: row.trigger as TaskTrigger | null, action: row.action as TaskAction | null }));
}

export async function createTask(input: {
  id: string; userId: string; requestId: string; prompt: string; status: Task["status"];
  gmailConnectionId?: string | null; trigger?: TaskTrigger | null; action?: TaskAction | null; question?: string | null; context?: unknown; parserModel: string; executionMode?: "automatic" | "approval";
}) {
  await db.insert(tasks).values({
    id: input.id,
    userId: input.userId,
    requestId: input.requestId,
    originalPrompt: input.prompt,
    status: input.status,
    gmailConnectionId: input.gmailConnectionId ?? null,
    trigger: input.trigger ?? null,
    action: input.action ?? null,
    clarificationQuestion: input.question ?? null,
    clarificationContext: input.context ?? null,
    parserModel: input.parserModel,
    executionMode: input.executionMode ?? "automatic",
    activationAt: input.status === "active" ? new Date().toISOString() : null,
  }).onConflictDoNothing({ target: [tasks.userId, tasks.requestId] });
  return findTaskByRequest(input.userId, input.requestId);
}

export async function claimTaskCreation() {
  const rows = await db.execute<{ id: string; userId: string; prompt: string; gmailConnectionId: string; executionMode: "automatic" | "approval" }>(sql`
    WITH next AS (
      SELECT id FROM tasks
      WHERE status = 'creating' OR (status = 'parsing' AND updated_at < NOW() - INTERVAL '5 minutes')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE tasks t SET status = 'parsing', updated_at = NOW()
    FROM next WHERE t.id = next.id
    RETURNING t.id, t.user_id AS "userId", t.original_prompt AS prompt,
      t.gmail_connection_id AS "gmailConnectionId", t.execution_mode AS "executionMode"
  `);
  return rows[0] ?? null;
}

export async function completeTaskCreation(input: { id: string; trigger?: TaskTrigger; action?: TaskAction; question?: string; context?: unknown; parserModel: string }) {
  const status = input.question ? "needs_clarification" : "active";
  await db.update(tasks).set({
    status,
    trigger: input.trigger ?? null,
    action: input.action ?? null,
    clarificationQuestion: input.question ?? null,
    clarificationContext: input.context ?? null,
    parserModel: input.parserModel,
    activationAt: status === "active" ? sql`now()` : null,
    updatedAt: sql`now()`,
  }).where(and(eq(tasks.id, input.id), eq(tasks.status, "parsing")));
}

export async function failTaskCreation(id: string, parserModel: string, error: string) {
  await db.update(tasks).set({ status: "parse_failed", parserModel, clarificationContext: { error }, updatedAt: sql`now()` })
    .where(and(eq(tasks.id, id), eq(tasks.status, "parsing")));
}

export async function resolveTaskClarification(input: { id: string; userId: string; gmailConnectionId: string; prompt: string; trigger: TaskTrigger; action: TaskAction; parserModel: string }) {
  const [task] = await db.update(tasks).set({
    originalPrompt: input.prompt,
    status: "active",
    gmailConnectionId: input.gmailConnectionId,
    trigger: input.trigger,
    action: input.action,
    clarificationQuestion: null,
    clarificationContext: null,
    parserModel: input.parserModel,
    activationAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(eq(tasks.id, input.id), eq(tasks.userId, input.userId), eq(tasks.status, "needs_clarification"))).returning(taskSelection);
  return task ? { ...task, trigger: task.trigger as TaskTrigger, action: task.action as TaskAction } : null;
}

export async function updateTaskClarification(userId: string, id: string, question: string, context: unknown, parserModel: string) {
  const [task] = await db.update(tasks).set({
    clarificationQuestion: question, clarificationContext: context, parserModel, updatedAt: sql`now()`,
  }).where(and(eq(tasks.id, id), eq(tasks.userId, userId), eq(tasks.status, "needs_clarification"))).returning(taskSelection);
  return task ? { ...task, trigger: task.trigger as TaskTrigger | null, action: task.action as TaskAction | null } : null;
}

export async function updateTaskStatus(userId: string, id: string, status: "active" | "paused" | "archived") {
  const [task] = await db.update(tasks).set({ status, updatedAt: sql`now()` })
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), ne(tasks.status, "needs_clarification"))).returning(taskSelection);
  return task ? { ...task, trigger: task.trigger as TaskTrigger | null, action: task.action as TaskAction | null } : null;
}

export async function getGmailConnection(userId: string, id: string) {
  const [connection] = await db.select(gmailConnectionSelection).from(gmailConnections)
    .where(and(eq(gmailConnections.userId, userId), eq(gmailConnections.id, id))).limit(1);
  return connection ?? null;
}

export async function getGmailConnectionById(id: string) {
  const [connection] = await db.select(gmailConnectionSelection).from(gmailConnections).where(eq(gmailConnections.id, id)).limit(1);
  return connection ?? null;
}

export async function listGmailConnections(userId: string) {
  return db.select(gmailConnectionSelection).from(gmailConnections).where(eq(gmailConnections.userId, userId)).orderBy(desc(gmailConnections.createdAt));
}

export async function getGmailConnectionByAddress(gmailAddress: string) {
  const [connection] = await db.select(gmailConnectionSelection).from(gmailConnections)
    .where(and(ilike(gmailConnections.gmailAddress, gmailAddress), eq(gmailConnections.status, "connected"))).limit(1);
  return connection ?? null;
}

const gmailConnectionSelection = {
  id: gmailConnections.id,
  userId: gmailConnections.userId,
  gmailAddress: gmailConnections.gmailAddress,
  encryptedRefreshToken: gmailConnections.encryptedRefreshToken,
  grantedScopes: gmailConnections.grantedScopes,
  labelMap: gmailConnections.gmailLabels,
  status: gmailConnections.status,
  historyId: gmailConnections.historyId,
  watchExpiration: gmailConnections.watchExpiration,
  lastSyncedAt: gmailConnections.lastSyncedAt,
};

export async function saveGmailConnection(input: Omit<GmailConnection, "historyId" | "watchExpiration" | "lastSyncedAt" | "labelMap"> & { labelMap?: Record<string, string>; historyId?: string | null; watchExpiration?: Date | null }) {
  await db.insert(gmailConnections).values({
    id: input.id,
    userId: input.userId,
    gmailAddress: input.gmailAddress,
    encryptedRefreshToken: input.encryptedRefreshToken,
    grantedScopes: input.grantedScopes,
    gmailLabels: input.labelMap ?? {},
    status: input.status,
    historyId: input.historyId ?? null,
    watchExpiration: input.watchExpiration?.toISOString() ?? null,
  }).onConflictDoUpdate({
    target: [gmailConnections.userId, gmailConnections.gmailAddress],
    set: {
      gmailAddress: input.gmailAddress,
      encryptedRefreshToken: input.encryptedRefreshToken,
      grantedScopes: input.grantedScopes,
      gmailLabels: input.labelMap ?? {},
      status: input.status,
      historyId: sql`coalesce(excluded.history_id, ${gmailConnections.historyId})`,
      watchExpiration: sql`coalesce(excluded.watch_expiration, ${gmailConnections.watchExpiration})`,
      updatedAt: sql`now()`,
    },
  });
}

export async function updateGmailCursor(connectionId: string, historyId: string, watchExpiration?: Date) {
  await db.update(gmailConnections).set({
    historyId,
    lastSyncedAt: sql`now()`,
    watchExpiration: watchExpiration ? watchExpiration.toISOString() : sql`coalesce(null, ${gmailConnections.watchExpiration})`,
    updatedAt: sql`now()`,
  }).where(eq(gmailConnections.id, connectionId));
}

export async function updateGmailWatchExpiration(connectionId: string, watchExpiration: Date) {
  await db.update(gmailConnections).set({ watchExpiration: watchExpiration.toISOString(), updatedAt: sql`now()` })
    .where(eq(gmailConnections.id, connectionId));
}

export async function listGmailConnectionsNeedingWatchRenewal() {
  return db.select(gmailConnectionSelection).from(gmailConnections).where(and(
    eq(gmailConnections.status, "connected"),
    or(isNull(gmailConnections.watchExpiration), lt(gmailConnections.watchExpiration, sql`now() + interval '2 days'`)),
  ));
}

export async function disconnectGmail(connectionId: string) {
  await db.update(gmailConnections).set({
    status: "disconnected", encryptedRefreshToken: "", historyId: null, watchExpiration: null, updatedAt: sql`now()`,
  }).where(eq(gmailConnections.id, connectionId));
}

export async function markGmailReconnect(connectionId: string) {
  await db.update(gmailConnections).set({ status: "needs_reconnect", updatedAt: sql`now()` })
    .where(eq(gmailConnections.id, connectionId));
}

export async function enqueueGmailNotification(input: { id: string; userId: string; gmailConnectionId: string; pubsubMessageId: string; historyId: string }) {
  const result = await db.insert(sourceEvents).values({
    id: input.id,
    userId: input.userId,
    gmailConnectionId: input.gmailConnectionId,
    kind: "gmail.notification",
    pubsubMessageId: input.pubsubMessageId,
    historyId: input.historyId,
    dedupKey: `pubsub:${input.pubsubMessageId}`,
  }).onConflictDoNothing({ target: sourceEvents.dedupKey }).returning({ id: sourceEvents.id });
  return result.length > 0;
}

export async function claimSourceEvent() {
  const rows = await db.execute<{ id: string; connectionId: string; attempts: number }>(sql`
    WITH next AS (
      SELECT id FROM source_events WHERE kind = 'gmail.notification' AND processing_state = 'pending' AND available_at <= NOW()
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE source_events e SET processing_state = 'processing', attempts = attempts + 1, updated_at = NOW()
    FROM next WHERE e.id = next.id RETURNING e.id, e.gmail_connection_id AS "connectionId", e.attempts`);
  const [event] = rows;
  return event ?? null;
}

export async function persistGmailMessage(connection: GmailConnection, message: { id: string; threadId?: string; historyId?: string; sender: string; subject: string; snippet?: string; receivedAt?: string }) {
  const [event] = await db.insert(sourceEvents).values({
    id: randomId(),
    userId: connection.userId,
    gmailConnectionId: connection.id,
    kind: "gmail.message",
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    historyId: message.historyId ?? null,
    dedupKey: `gmail:${connection.id}:${message.id}`,
    headers: { from: message.sender, subject: message.subject },
    snippet: message.snippet ?? "",
    occurredAt: message.receivedAt ? new Date(message.receivedAt).toISOString() : new Date().toISOString(),
    processingState: "completed",
  }).onConflictDoUpdate({
    target: sourceEvents.dedupKey,
    set: { headers: { from: message.sender, subject: message.subject }, snippet: message.snippet ?? "", updatedAt: sql`now()` },
  }).returning({ id: sourceEvents.id });
  return event!;
}

function randomId() {
  return crypto.randomUUID();
}

async function findMessageEventId(notificationEventId: string, messageId: string) {
  const notification = alias(sourceEvents, "notification");
  const message = alias(sourceEvents, "message");
  const [event] = await db.select({ id: message.id }).from(notification).innerJoin(message, and(
    eq(message.gmailConnectionId, notification.gmailConnectionId),
    eq(message.gmailMessageId, messageId),
  )).where(eq(notification.id, notificationEventId)).limit(1);
  if (!event) throw new Error(`Persisted Gmail message ${messageId} was not found`);
  return event.id;
}

export async function getTaskRunDecision(input: { taskId: string; notificationEventId: string; messageId: string }) {
  const sourceEventId = await findMessageEventId(input.notificationEventId, input.messageId);
  const [run] = await db.select({ status: taskRuns.status, matchingEvidence: taskRuns.matchingEvidence })
    .from(taskRuns).where(and(eq(taskRuns.taskId, input.taskId), eq(taskRuns.sourceEventId, sourceEventId))).limit(1);
  if (!run) return null;
  const evidence = Array.isArray(run.matchingEvidence) ? run.matchingEvidence.filter((item): item is string => typeof item === "string") : [];
  const confidence = evidence.find((item) => item.startsWith("confidence:"))?.slice("confidence:".length);
  const parsedConfidence: "low" | "medium" | "high" = confidence === "low" || confidence === "medium" ? confidence : "high";
  return {
    matches: run.status !== "not_matched",
    confidence: parsedConfidence,
    reason: evidence[0] ?? (run.status === "not_matched" ? "The model classified this email as unrelated." : "The model classified this email as relevant."),
  };
}

export async function claimTaskRun(input: {
  taskId: string;
  notificationEventId: string;
  messageId: string;
  decision: { matches: boolean; confidence: "low" | "medium" | "high"; reason: string };
  requiresApproval?: boolean;
}) {
  const sourceEventId = await findMessageEventId(input.notificationEventId, input.messageId);
  const matchingEvidence = [input.decision.reason, `confidence:${input.decision.confidence}`, `model:${process.env.GMAIL_MATCH_MODEL ?? "gpt-5-nano"}`];
  if (!input.decision.matches) {
    await db.insert(taskRuns).values({
      id: randomId(), taskId: input.taskId, sourceEventId, status: "not_matched", matchingEvidence,
    }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] });
    return null;
  }
  const [run] = await db.insert(taskRuns).values({
    id: randomId(),
    taskId: input.taskId,
    sourceEventId,
    status: "pending",
    approvalStatus: input.requiresApproval ? "pending" : "not_required",
    matchingEvidence,
  }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] }).returning({ id: taskRuns.id, attempts: taskRuns.attempts });
  return run ? { ...run, awaitingApproval: input.requiresApproval } : null;
}

export async function markTaskRunDispatched(runId: string, callId: string) {
  await db.update(taskRuns).set({ status: "calling", callTaskId: callId, error: null, updatedAt: sql`now()` })
    .where(eq(taskRuns.id, runId));
}

export async function markTaskRunFailed(runId: string, error: string, retryAt: Date | null) {
  await db.update(taskRuns).set({
    status: "failed", error, availableAt: retryAt?.toISOString() ?? null, updatedAt: sql`now()`,
  }).where(eq(taskRuns.id, runId));
}

export async function advanceSourceEvent(eventId: string, error?: string, retryAt?: Date | null) {
  if (error && retryAt) {
    await db.update(sourceEvents).set({
      processingState: "pending", error, availableAt: retryAt.toISOString(), updatedAt: sql`now()`,
    }).where(eq(sourceEvents.id, eventId));
  } else if (error) {
    await db.update(sourceEvents).set({ processingState: "failed", error, updatedAt: sql`now()` })
      .where(eq(sourceEvents.id, eventId));
  } else {
    await db.update(sourceEvents).set({ processingState: "completed", error: null, updatedAt: sql`now()` })
      .where(eq(sourceEvents.id, eventId));
  }
}

export async function listTaskRuns(userId: string) {
  return db.select({
    id: taskRuns.id,
    taskId: taskRuns.taskId,
    taskPrompt: tasks.originalPrompt,
    status: taskRuns.status,
    approvalStatus: taskRuns.approvalStatus,
    sender: sql<string | null>`${sourceEvents.headers}->>'from'`,
    subject: sql<string | null>`${sourceEvents.headers}->>'subject'`,
    snippet: sourceEvents.snippet,
    matchingEvidence: taskRuns.matchingEvidence,
    callId: taskRuns.callTaskId,
    result: taskRuns.result,
    error: taskRuns.error,
    createdAt: taskRuns.createdAt,
    updatedAt: taskRuns.updatedAt,
  }).from(taskRuns)
    .innerJoin(tasks, eq(tasks.id, taskRuns.taskId))
    .innerJoin(sourceEvents, eq(sourceEvents.id, taskRuns.sourceEventId))
    .where(eq(tasks.userId, userId)).orderBy(desc(taskRuns.createdAt)).limit(100);
}

export async function decideTaskRunApproval(userId: string, runId: string, decision: "approved" | "rejected") {
  const [run] = await db.update(taskRuns).set({ approvalStatus: decision, updatedAt: sql`now()` })
    .from(tasks)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, tasks.id), eq(tasks.userId, userId), eq(taskRuns.status, "pending"), eq(taskRuns.approvalStatus, "pending")))
    .returning({ id: taskRuns.id, approvalStatus: taskRuns.approvalStatus });
  return run ?? null;
}

export async function claimApprovedTaskRun() {
  const [claimed] = await db.update(taskRuns).set({ status: "calling", updatedAt: sql`now()` })
    .where(and(eq(taskRuns.status, "pending"), eq(taskRuns.approvalStatus, "approved")))
    .returning({ id: taskRuns.id });
  if (!claimed) return null;
  const [run] = await db.select({
    id: taskRuns.id, taskId: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt, trigger: tasks.trigger, action: tasks.action,
    gmailMessageId: sourceEvents.gmailMessageId, connectionId: gmailConnections.id, gmailAddress: gmailConnections.gmailAddress,
    encryptedRefreshToken: gmailConnections.encryptedRefreshToken, grantedScopes: gmailConnections.grantedScopes, labelMap: gmailConnections.gmailLabels,
    connectionStatus: gmailConnections.status, historyId: gmailConnections.historyId, watchExpiration: gmailConnections.watchExpiration, lastSyncedAt: gmailConnections.lastSyncedAt,
  }).from(taskRuns).innerJoin(tasks, eq(tasks.id, taskRuns.taskId)).innerJoin(sourceEvents, eq(sourceEvents.id, taskRuns.sourceEventId))
    .innerJoin(gmailConnections, eq(gmailConnections.id, sourceEvents.gmailConnectionId)).where(eq(taskRuns.id, claimed.id)).limit(1);
  return run ?? null;
}

export async function saveCallTask(call: { id: string; userId: string; task: string; phone: string; status: string; taskRunId?: string }) {
  await db.insert(callTasks).values({ ...call, taskRunId: call.taskRunId ?? null }).onConflictDoNothing({ target: callTasks.id });
}

export async function updateCallTask(call: { id: string; status: string; summary?: string | null; result?: unknown }) {
  await db.update(callTasks).set({
    status: call.status, summary: call.summary ?? null, result: call.result ?? null, updatedAt: sql`now()`,
  }).where(eq(callTasks.id, call.id));
  await db.update(taskRuns).set({
    status: call.status === "completed" ? "completed" : call.status === "failed" ? "failed" : "calling",
    result: call.result ?? null,
    updatedAt: sql`now()`,
  }).where(eq(taskRuns.callTaskId, call.id));
}

export async function queueConfirmedEmailReply(callId: string) {
  await db.update(callTasks).set({ replyStatus: "pending", replyError: null, updatedAt: sql`now()` })
    .where(and(eq(callTasks.id, callId), eq(callTasks.replyStatus, "not_requested")));
}

export type PendingEmailReply = {
  callId: string;
  result: unknown;
  instruction: string;
  originalPrompt: string;
  gmailConnection: GmailConnection;
  gmailMessageId: string;
};

export async function claimPendingEmailReply(): Promise<PendingEmailReply | null> {
  const [claimed] = await db.update(callTasks).set({ replyStatus: "sending", updatedAt: sql`now()` })
    .where(and(eq(callTasks.replyStatus, "pending"), isNull(callTasks.replyMessageId)))
    .returning({ id: callTasks.id });
  if (!claimed) return null;

  const [reply] = await db.select({
    callId: callTasks.id,
    result: callTasks.result,
    instruction: tasks.action,
    originalPrompt: tasks.originalPrompt,
    gmailMessageId: sourceEvents.gmailMessageId,
    connectionId: gmailConnections.id,
    userId: gmailConnections.userId,
    gmailAddress: gmailConnections.gmailAddress,
    encryptedRefreshToken: gmailConnections.encryptedRefreshToken,
    grantedScopes: gmailConnections.grantedScopes,
    labelMap: gmailConnections.gmailLabels,
    connectionStatus: gmailConnections.status,
    historyId: gmailConnections.historyId,
    watchExpiration: gmailConnections.watchExpiration,
    lastSyncedAt: gmailConnections.lastSyncedAt,
  }).from(callTasks)
    .innerJoin(taskRuns, eq(taskRuns.id, callTasks.taskRunId))
    .innerJoin(tasks, eq(tasks.id, taskRuns.taskId))
    .innerJoin(sourceEvents, eq(sourceEvents.id, taskRuns.sourceEventId))
    .innerJoin(gmailConnections, eq(gmailConnections.id, sourceEvents.gmailConnectionId))
    .where(eq(callTasks.id, claimed.id)).limit(1);
  if (!reply?.gmailMessageId || !reply.instruction || typeof reply.instruction !== "object") return null;
  const action = reply.instruction as TaskAction;
  return {
    callId: reply.callId,
    result: reply.result,
    instruction: action.task,
    originalPrompt: reply.originalPrompt,
    gmailMessageId: reply.gmailMessageId,
    gmailConnection: {
      id: reply.connectionId,
      userId: reply.userId,
      gmailAddress: reply.gmailAddress,
      encryptedRefreshToken: reply.encryptedRefreshToken,
      grantedScopes: reply.grantedScopes,
      labelMap: reply.labelMap,
      status: reply.connectionStatus,
      historyId: reply.historyId,
      watchExpiration: reply.watchExpiration,
      lastSyncedAt: reply.lastSyncedAt,
    },
  };
}

export async function markEmailReplySent(callId: string, messageId: string) {
  await db.update(callTasks).set({ replyStatus: "sent", replyMessageId: messageId, replyError: null, updatedAt: sql`now()` })
    .where(and(eq(callTasks.id, callId), eq(callTasks.replyStatus, "sending")));
}

export async function markEmailReplyFailed(callId: string, error: string) {
  await db.update(callTasks).set({ replyStatus: "failed", replyError: error, updatedAt: sql`now()` })
    .where(and(eq(callTasks.id, callId), eq(callTasks.replyStatus, "sending")));
}

export async function listCallTasks(userId: string) {
  return db.select({
    id: callTasks.id,
    task: callTasks.task,
    phone: callTasks.phone,
    status: callTasks.status,
    summary: callTasks.summary,
    result: callTasks.result,
    createdAt: callTasks.createdAt,
    updatedAt: callTasks.updatedAt,
  }).from(callTasks).where(eq(callTasks.userId, userId)).orderBy(desc(callTasks.createdAt));
}
