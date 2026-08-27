// PostgreSQL persistence for users, Gmail task definitions, durable events, runs, and calls.
import { SQL } from "bun";
import { and, desc, eq, ilike, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { alias } from "drizzle-orm/pg-core";
import { callTasks, contacts, gmailConnections, integrationConnections, notionConnections, sourceEvents, taskRuns, tasks, users, vercelConnections } from "./schema";
import type { PublicSignal, PublicSourceState } from "./public-sources";
import type { IntegrationEvent, IntegrationProvider } from "./integrations";
import type { CalleAnsweredBy, CalleCallRecipient, CalleCompletionConfidence, CalleProviderError, CalleSource } from "./calle";

export type Contact = {
  id: string;
  name: string;
  summary: string;
  phone: string;
  email: string | null;
  createdAt: string;
};

export type GmailTaskTrigger = {
  type: "email.received";
  match: "and";
  senders: string[];
  subjectKeywords: string[];
  bodyKeywords: string[];
  labels: string[];
};

export type VercelTaskTrigger = {
  type: "deployment.failed";
  projectIds: string[];
  projectNames: string[];
  environments: Array<"production" | "preview">;
};

export type NotionTaskTrigger = {
  type: "notion.page.updated";
  pageIds: string[];
  pageTitles: string[];
  keywords: string[];
};

export type IntegrationTaskTrigger = {
  type: "integration.event";
  provider: IntegrationProvider;
  eventNames: string[];
  keywords: string[];
  withinMinutes: number;
};

export type PublicTaskTrigger = {
  type: "weather.rain_forecast";
  location: string;
  latitude: number;
  longitude: number;
  minimumPrecipitationMm: number;
  withinHours: number;
  consecutiveHours: number;
} | {
  type: "sec.filing.published";
  cik: string;
  companyName: string;
  forms: string[];
} | {
  type: "usgs.earthquake.detected";
  location: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  minimumMagnitude: number;
} | {
  type: "nasa.event.opened";
  categories: string[];
  location: string;
  bbox: [number, number, number, number] | [];
} | {
  type: "fx.rate.threshold";
  base: string;
  quote: string;
  operator: "above" | "below";
  threshold: number;
} | {
  type: "india.stock.price_threshold";
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  operator: "above" | "below";
  price: number;
} | {
  type: "india.stock.daily_move";
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  direction: "gain" | "loss";
  percent: number;
} | {
  type: "india.stock.volume_threshold";
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  minimumVolume: number;
};

export type TaskTrigger = GmailTaskTrigger | VercelTaskTrigger | NotionTaskTrigger | IntegrationTaskTrigger | PublicTaskTrigger;

export type TaskAction = {
  type: "calle.call";
  targetType: "self" | "contact";
  targetId?: string;
  targetName: string;
  phone: string;
  task: string;
  executionMode?: "automatic" | "approval";
};

export type CallProfileUpdate = {
  defaultPhone?: string | null;
  callRegion?: string | null;
  callLocale?: string | null;
};

export type Task = {
  id: string;
  userId: string;
  gmailConnectionId: string | null;
  vercelConnectionId: string | null;
  notionConnectionId: string | null;
  integrationConnectionId: string | null;
  originalPrompt: string;
  status: "creating" | "parsing" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed";
  trigger: TaskTrigger | null;
  action: TaskAction | null;
  clarificationQuestion: string | null;
  clarificationContext: unknown;
  parserModel: string;
  executionMode: "automatic" | "approval";
  publicSourceState: PublicSourceState | null;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationConnection = {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  label: string;
  encryptedCredential: string;
  metadata: Record<string, unknown>;
  status: "connected" | "needs_reconnect" | "disconnected";
  lastPolledAt: string;
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

export type VercelConnection = {
  id: string;
  userId: string;
  accountId: string;
  accountName: string;
  accountSlug: string;
  teamId: string | null;
  encryptedAccessToken: string;
  projects: Array<{ id: string; name: string }>;
  status: "connected" | "needs_reconnect" | "disconnected";
  lastPolledAt: string;
};

export type NotionConnection = {
  id: string;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  pages: Array<{ id: string; title: string; url: string }>;
  status: "connected" | "needs_reconnect" | "disconnected";
  lastPolledAt: string;
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
      call_region VARCHAR(2),
      call_locale VARCHAR(35),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS call_region VARCHAR(2);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS call_locale VARCHAR(35);

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

    CREATE TABLE IF NOT EXISTS vercel_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_slug TEXT NOT NULL,
      team_id TEXT,
      encrypted_access_token TEXT NOT NULL,
      projects JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reconnect', 'disconnected')),
      last_polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vercel_connections_user_account_key ON vercel_connections(user_id, account_id);

    CREATE TABLE IF NOT EXISTS notion_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      workspace_icon TEXT,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL,
      pages JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reconnect', 'disconnected')),
      last_polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notion_connections_user_workspace_key ON notion_connections(user_id, workspace_id);

    CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('github', 'stripe', 'google_calendar', 'n8n')),
      label TEXT NOT NULL,
      encrypted_credential TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('connected', 'needs_reconnect', 'disconnected')),
      last_polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_user_provider_key ON integration_connections(user_id, provider);

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
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS vercel_connection_id TEXT REFERENCES vercel_connections(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notion_connection_id TEXT REFERENCES notion_connections(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS integration_connection_id TEXT REFERENCES integration_connections(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS public_source_state JSONB;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;
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
    ALTER TABLE source_events ALTER COLUMN gmail_connection_id DROP NOT NULL;
    ALTER TABLE source_events ADD COLUMN IF NOT EXISTS vercel_connection_id TEXT REFERENCES vercel_connections(id) ON DELETE CASCADE;
    ALTER TABLE source_events ADD COLUMN IF NOT EXISTS notion_connection_id TEXT REFERENCES notion_connections(id) ON DELETE CASCADE;
    ALTER TABLE source_events ADD COLUMN IF NOT EXISTS integration_connection_id TEXT REFERENCES integration_connections(id) ON DELETE CASCADE;
    ALTER TABLE source_events DROP CONSTRAINT IF EXISTS source_events_kind_check;
    ALTER TABLE source_events ADD CONSTRAINT source_events_kind_check CHECK (kind IN ('gmail.notification', 'gmail.message', 'vercel.deployment.failed', 'notion.page.updated', 'public.signal', 'integration.event'));

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
    ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS provider_error JSONB;
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
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'generic';
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS region VARCHAR(2);
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS locale VARCHAR(35);
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS task_completed BOOLEAN;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS completion_confidence JSONB;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS recipients JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS answered_by VARCHAR(20);
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS failure_code TEXT;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS failure_message TEXT;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS provider_event_id TEXT;
    ALTER TABLE call_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS call_tasks_run_key ON call_tasks(task_run_id) WHERE task_run_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS call_dispatch_reservations (
      event_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS call_dispatch_reservations_user_created_idx ON call_dispatch_reservations(user_id, created_at);
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
    callRegion: users.callRegion, callLocale: users.callLocale,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return profile ?? null;
}

export async function updateProfile(userId: string, update: CallProfileUpdate) {
  const [profile] = await db.update(users).set({
    ...(update.defaultPhone !== undefined ? { defaultPhone: update.defaultPhone } : {}),
    ...(update.callRegion !== undefined ? { callRegion: update.callRegion } : {}),
    ...(update.callLocale !== undefined ? { callLocale: update.callLocale } : {}),
    updatedAt: sql`now()`,
  }).where(eq(users.id, userId)).returning({
    email: users.email, name: users.name, picture: users.picture, defaultPhone: users.defaultPhone,
    callRegion: users.callRegion, callLocale: users.callLocale,
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

export async function getTaskContext(userId: string, input: { gmailConnectionId?: string | null; vercelConnectionId?: string | null; notionConnectionId?: string | null; integrationConnectionId?: string | null }) {
  const [profile, gmail, vercel, notion, integration, contacts] = await Promise.all([
    getProfile(userId),
    input.gmailConnectionId ? getGmailConnection(userId, input.gmailConnectionId) : null,
    input.vercelConnectionId ? getVercelConnection(userId, input.vercelConnectionId) : null,
    input.notionConnectionId ? getNotionConnection(userId, input.notionConnectionId) : null,
    input.integrationConnectionId ? getIntegrationConnection(userId, input.integrationConnectionId) : null,
    listContacts(userId),
  ]);
  return { profile, gmail, vercel, notion, integration, contacts };
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

export async function taskCreationCapacity(userId: string) {
  const rows = await db.execute<{ active: number; recent: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('archived', 'parse_failed'))::int AS active,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')::int AS recent
    FROM tasks WHERE user_id = ${userId}
  `);
  return rows[0] ?? { active: 0, recent: 0 };
}

export async function listActiveWorkerTasks(gmailConnectionId: string) {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt, trigger: tasks.trigger, action: tasks.action, activationAt: tasks.activationAt,
  }).from(tasks).where(and(eq(tasks.gmailConnectionId, gmailConnectionId), eq(tasks.status, "active")));
  return rows.map(({ id, userId: ownerId, originalPrompt, trigger, action, activationAt }) => {
    const parsedTrigger = trigger as GmailTaskTrigger;
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
  vercelConnectionId: tasks.vercelConnectionId,
  notionConnectionId: tasks.notionConnectionId,
  integrationConnectionId: tasks.integrationConnectionId,
  originalPrompt: tasks.originalPrompt,
  status: tasks.status,
  trigger: tasks.trigger,
  action: tasks.action,
  clarificationQuestion: tasks.clarificationQuestion,
  clarificationContext: tasks.clarificationContext,
  parserModel: tasks.parserModel,
  executionMode: tasks.executionMode,
  publicSourceState: tasks.publicSourceState,
  lastPolledAt: tasks.lastPolledAt,
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
  gmailConnectionId?: string | null; vercelConnectionId?: string | null; notionConnectionId?: string | null; integrationConnectionId?: string | null; trigger?: TaskTrigger | null; action?: TaskAction | null; question?: string | null; context?: unknown; parserModel: string; executionMode?: "automatic" | "approval";
}) {
  await db.insert(tasks).values({
    id: input.id,
    userId: input.userId,
    requestId: input.requestId,
    originalPrompt: input.prompt,
    status: input.status,
    gmailConnectionId: input.gmailConnectionId ?? null,
    vercelConnectionId: input.vercelConnectionId ?? null,
    notionConnectionId: input.notionConnectionId ?? null,
    integrationConnectionId: input.integrationConnectionId ?? null,
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
  const rows = await db.execute<{ id: string; userId: string; prompt: string; gmailConnectionId: string | null; vercelConnectionId: string | null; notionConnectionId: string | null; integrationConnectionId: string | null; executionMode: "automatic" | "approval" }>(sql`
    WITH next AS (
      SELECT id FROM tasks
      WHERE status = 'creating' OR (status = 'parsing' AND updated_at < NOW() - INTERVAL '5 minutes')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE tasks t SET status = 'parsing', updated_at = NOW()
    FROM next WHERE t.id = next.id
    RETURNING t.id, t.user_id AS "userId", t.original_prompt AS prompt,
      t.gmail_connection_id AS "gmailConnectionId", t.vercel_connection_id AS "vercelConnectionId", t.notion_connection_id AS "notionConnectionId", t.integration_connection_id AS "integrationConnectionId", t.execution_mode AS "executionMode"
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

export async function resolveTaskClarification(input: { id: string; userId: string; gmailConnectionId?: string | null; vercelConnectionId?: string | null; notionConnectionId?: string | null; integrationConnectionId?: string | null; prompt: string; trigger: TaskTrigger; action: TaskAction; parserModel: string }) {
  const [task] = await db.update(tasks).set({
    originalPrompt: input.prompt,
    status: "active",
    gmailConnectionId: input.gmailConnectionId ?? null,
    vercelConnectionId: input.vercelConnectionId ?? null,
    notionConnectionId: input.notionConnectionId ?? null,
    integrationConnectionId: input.integrationConnectionId ?? null,
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

export async function claimPublicTaskForPolling() {
  const rows = await db.execute<{
    id: string;
    userId: string;
    originalPrompt: string;
    trigger: PublicTaskTrigger;
    action: TaskAction;
    publicSourceState: PublicSourceState | null;
  }>(sql`
    WITH next AS (
      SELECT id FROM tasks
      WHERE status = 'active'
        AND trigger->>'type' IN ('weather.rain_forecast', 'sec.filing.published', 'usgs.earthquake.detected', 'nasa.event.opened', 'fx.rate.threshold', 'india.stock.price_threshold', 'india.stock.daily_move', 'india.stock.volume_threshold')
        AND (
          (
            trigger->>'type' NOT LIKE 'india.stock.%'
            AND (last_polled_at IS NULL OR last_polled_at <= NOW() - INTERVAL '15 minutes')
          ) OR (
            trigger->>'type' LIKE 'india.stock.%'
            AND (
              last_polled_at IS NULL OR (
                (last_polled_at AT TIME ZONE 'Asia/Kolkata')::date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
                AND (NOW() AT TIME ZONE 'Asia/Kolkata')::time >= TIME '15:45'
                AND EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Kolkata') BETWEEN 1 AND 5
              )
            )
          )
        )
      ORDER BY last_polled_at NULLS FIRST, created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE tasks t SET last_polled_at = NOW()
    FROM next WHERE t.id = next.id
    RETURNING t.id, t.user_id AS "userId", t.original_prompt AS "originalPrompt", t.trigger, t.action,
      t.public_source_state AS "publicSourceState"
  `);
  return rows[0] ?? null;
}

export async function recordPublicSignal(task: {
  id: string;
  userId: string;
  trigger: PublicTaskTrigger;
  action: TaskAction;
}, signal: PublicSignal, state: PublicSourceState, fire: boolean) {
  let run: { id: string } | undefined;
  if (fire) {
    const [event] = await db.insert(sourceEvents).values({
      id: randomId(),
      userId: task.userId,
      kind: "public.signal",
      dedupKey: `public:${task.id}:${signal.fingerprint}`,
      headers: { provider: task.trigger.type, signal: signal.summary },
      snippet: signal.summary,
      occurredAt: signal.occurredAt,
      processingState: "completed",
    }).onConflictDoUpdate({
      target: sourceEvents.dedupKey,
      set: { updatedAt: sql`now()` },
    }).returning({ id: sourceEvents.id });
    [run] = await db.insert(taskRuns).values({
      id: randomId(),
      taskId: task.id,
      sourceEventId: event!.id,
      status: "pending",
      approvalStatus: task.action.executionMode === "approval" ? "pending" : "not_required",
      matchingEvidence: [signal.summary, "source:public"],
    }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] }).returning({ id: taskRuns.id });
  }
  await db.update(tasks).set({ publicSourceState: state }).where(eq(tasks.id, task.id));
  return run ? { ...run, awaitingApproval: task.action.executionMode === "approval" } : null;
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

const vercelConnectionSelection = {
  id: vercelConnections.id,
  userId: vercelConnections.userId,
  accountId: vercelConnections.accountId,
  accountName: vercelConnections.accountName,
  accountSlug: vercelConnections.accountSlug,
  teamId: vercelConnections.teamId,
  encryptedAccessToken: vercelConnections.encryptedAccessToken,
  projects: vercelConnections.projects,
  status: vercelConnections.status,
  lastPolledAt: vercelConnections.lastPolledAt,
};

export async function getVercelConnection(userId: string, id: string) {
  const [connection] = await db.select(vercelConnectionSelection).from(vercelConnections)
    .where(and(eq(vercelConnections.userId, userId), eq(vercelConnections.id, id))).limit(1);
  return connection ?? null;
}

export async function listVercelConnections(userId: string) {
  return db.select(vercelConnectionSelection).from(vercelConnections)
    .where(eq(vercelConnections.userId, userId)).orderBy(desc(vercelConnections.createdAt));
}

export async function saveVercelConnection(input: Omit<VercelConnection, "lastPolledAt">) {
  await db.insert(vercelConnections).values({
    ...input,
    lastPolledAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [vercelConnections.userId, vercelConnections.accountId],
    set: {
      accountName: input.accountName,
      accountSlug: input.accountSlug,
      teamId: input.teamId,
      encryptedAccessToken: input.encryptedAccessToken,
      projects: input.projects,
      status: "connected",
      lastPolledAt: sql`now()`,
      updatedAt: sql`now()`,
    },
  });
}

export async function disconnectVercel(connectionId: string) {
  await db.update(vercelConnections).set({ status: "disconnected", updatedAt: sql`now()` })
    .where(eq(vercelConnections.id, connectionId));
}

export async function claimVercelConnectionForPolling() {
  const rows = await db.execute<VercelConnection & { pollSince: string; pollUntil: string }>(sql`
    WITH next AS (
      SELECT * FROM vercel_connections
      WHERE status = 'connected' AND last_polled_at <= NOW() - INTERVAL '5 minutes'
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.vercel_connection_id = vercel_connections.id AND tasks.status = 'active'
        )
      ORDER BY last_polled_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE vercel_connections v SET last_polled_at = NOW(), updated_at = NOW()
    FROM next WHERE v.id = next.id
    RETURNING v.id, v.user_id AS "userId", v.account_id AS "accountId", v.account_name AS "accountName",
      v.account_slug AS "accountSlug", v.team_id AS "teamId", v.encrypted_access_token AS "encryptedAccessToken",
      v.projects, v.status, v.last_polled_at AS "lastPolledAt", next.last_polled_at AS "pollSince", NOW() AS "pollUntil"
  `);
  return rows[0] ?? null;
}

export async function completeVercelPoll(connectionId: string, pollUntil: string) {
  await db.update(vercelConnections).set({ lastPolledAt: pollUntil, updatedAt: sql`now()` })
    .where(eq(vercelConnections.id, connectionId));
}

export async function markVercelReconnect(connectionId: string) {
  await db.update(vercelConnections).set({ status: "needs_reconnect", updatedAt: sql`now()` })
    .where(eq(vercelConnections.id, connectionId));
}

export async function persistVercelDeployment(input: {
  connection: VercelConnection;
  deployment: { uid: string; projectId: string; name: string; url: string; target: "production" | "preview" | null; created: number; meta?: Record<string, string> };
}) {
  const [event] = await db.insert(sourceEvents).values({
    id: randomId(),
    userId: input.connection.userId,
    vercelConnectionId: input.connection.id,
    kind: "vercel.deployment.failed",
    dedupKey: `vercel:${input.connection.id}:deployment:${input.deployment.uid}`,
    headers: {
      deploymentId: input.deployment.uid,
      projectId: input.deployment.projectId,
      projectName: input.deployment.name,
      target: input.deployment.target,
      url: input.deployment.url,
      gitCommitMessage: input.deployment.meta?.githubCommitMessage ?? input.deployment.meta?.gitlabCommitMessage ?? input.deployment.meta?.bitbucketCommitMessage ?? null,
    },
    occurredAt: new Date(input.deployment.created).toISOString(),
    processingState: "processing",
  }).onConflictDoNothing({ target: sourceEvents.dedupKey }).returning({ id: sourceEvents.id });
  return event?.id ?? null;
}

export async function listActiveVercelTasks(connectionId: string) {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt,
    trigger: tasks.trigger, action: tasks.action, activationAt: tasks.activationAt,
  }).from(tasks).where(and(eq(tasks.vercelConnectionId, connectionId), eq(tasks.status, "active")));
  return rows.map((row) => ({ ...row, trigger: row.trigger as VercelTaskTrigger, action: row.action as TaskAction }));
}

export async function claimVercelTaskRun(input: { taskId: string; eventId: string; requiresApproval: boolean }) {
  const [run] = await db.insert(taskRuns).values({
    id: randomId(),
    taskId: input.taskId,
    sourceEventId: input.eventId,
    status: "pending",
    approvalStatus: input.requiresApproval ? "pending" : "not_required",
    matchingEvidence: ["Vercel reported a failed deployment that matched the selected project and environment.", "source:vercel"],
  }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] })
    .returning({ id: taskRuns.id });
  return run ? { ...run, awaitingApproval: input.requiresApproval } : null;
}

const notionConnectionSelection = {
  id: notionConnections.id,
  userId: notionConnections.userId,
  workspaceId: notionConnections.workspaceId,
  workspaceName: notionConnections.workspaceName,
  workspaceIcon: notionConnections.workspaceIcon,
  encryptedAccessToken: notionConnections.encryptedAccessToken,
  encryptedRefreshToken: notionConnections.encryptedRefreshToken,
  pages: notionConnections.pages,
  status: notionConnections.status,
  lastPolledAt: notionConnections.lastPolledAt,
};

export async function getNotionConnection(userId: string, id: string) {
  const [connection] = await db.select(notionConnectionSelection).from(notionConnections)
    .where(and(eq(notionConnections.userId, userId), eq(notionConnections.id, id))).limit(1);
  return connection ?? null;
}

export async function listNotionConnections(userId: string) {
  return db.select(notionConnectionSelection).from(notionConnections)
    .where(eq(notionConnections.userId, userId)).orderBy(desc(notionConnections.createdAt));
}

export async function saveNotionConnection(input: Omit<NotionConnection, "lastPolledAt">) {
  await db.insert(notionConnections).values({ ...input, lastPolledAt: new Date().toISOString() }).onConflictDoUpdate({
    target: [notionConnections.userId, notionConnections.workspaceId],
    set: {
      workspaceName: input.workspaceName,
      workspaceIcon: input.workspaceIcon,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      pages: input.pages,
      status: "connected",
      lastPolledAt: sql`now()`,
      updatedAt: sql`now()`,
    },
  });
}

export async function disconnectNotion(connectionId: string) {
  await db.update(notionConnections).set({ status: "disconnected", encryptedAccessToken: "", encryptedRefreshToken: "", updatedAt: sql`now()` })
    .where(eq(notionConnections.id, connectionId));
}

export async function claimNotionConnectionForPolling() {
  const rows = await db.execute<NotionConnection & { pollSince: string; pollUntil: string }>(sql`
    WITH next AS (
      SELECT * FROM notion_connections
      WHERE status = 'connected' AND last_polled_at <= NOW() - INTERVAL '15 minutes'
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.notion_connection_id = notion_connections.id AND tasks.status = 'active'
        )
      ORDER BY last_polled_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE notion_connections n SET last_polled_at = NOW(), updated_at = NOW()
    FROM next WHERE n.id = next.id
    RETURNING n.id, n.user_id AS "userId", n.workspace_id AS "workspaceId", n.workspace_name AS "workspaceName",
      n.workspace_icon AS "workspaceIcon", n.encrypted_access_token AS "encryptedAccessToken", n.encrypted_refresh_token AS "encryptedRefreshToken",
      n.pages, n.status, n.last_polled_at AS "lastPolledAt", next.last_polled_at AS "pollSince", NOW() AS "pollUntil"
  `);
  return rows[0] ?? null;
}

export async function completeNotionPoll(connectionId: string, pollUntil: string, token: { encryptedAccessToken: string; encryptedRefreshToken: string }, pages: NotionConnection["pages"]) {
  await db.update(notionConnections).set({
    lastPolledAt: pollUntil,
    encryptedAccessToken: token.encryptedAccessToken,
    encryptedRefreshToken: token.encryptedRefreshToken,
    pages,
    updatedAt: sql`now()`,
  }).where(eq(notionConnections.id, connectionId));
}

export async function markNotionReconnect(connectionId: string) {
  await db.update(notionConnections).set({ status: "needs_reconnect", updatedAt: sql`now()` }).where(eq(notionConnections.id, connectionId));
}

export async function persistNotionPage(input: {
  connection: NotionConnection;
  page: { id: string; title: string; url: string; lastEditedTime: string; content: string };
}) {
  const [event] = await db.insert(sourceEvents).values({
    id: randomId(),
    userId: input.connection.userId,
    notionConnectionId: input.connection.id,
    kind: "notion.page.updated",
    dedupKey: `notion:${input.connection.id}:page:${input.page.id}:${input.page.lastEditedTime}`,
    headers: { pageId: input.page.id, pageTitle: input.page.title, pageUrl: input.page.url },
    snippet: input.page.content.slice(0, 2_000),
    occurredAt: input.page.lastEditedTime,
    processingState: "processing",
  }).onConflictDoNothing({ target: sourceEvents.dedupKey }).returning({ id: sourceEvents.id });
  return event?.id ?? null;
}

export async function listActiveNotionTasks(connectionId: string) {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt,
    trigger: tasks.trigger, action: tasks.action, activationAt: tasks.activationAt,
  }).from(tasks).where(and(eq(tasks.notionConnectionId, connectionId), eq(tasks.status, "active")));
  return rows.map((row) => ({ ...row, trigger: row.trigger as NotionTaskTrigger, action: row.action as TaskAction }));
}

export async function claimNotionTaskRun(input: { taskId: string; eventId: string; requiresApproval: boolean; evidence: unknown }) {
  const [run] = await db.insert(taskRuns).values({
    id: randomId(),
    taskId: input.taskId,
    sourceEventId: input.eventId,
    status: "pending",
    approvalStatus: input.requiresApproval ? "pending" : "not_required",
    matchingEvidence: input.evidence,
  }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] }).returning({ id: taskRuns.id });
  return run ? { ...run, awaitingApproval: input.requiresApproval } : null;
}

const integrationConnectionSelection = {
  id: integrationConnections.id,
  userId: integrationConnections.userId,
  provider: integrationConnections.provider,
  label: integrationConnections.label,
  encryptedCredential: integrationConnections.encryptedCredential,
  metadata: integrationConnections.metadata,
  status: integrationConnections.status,
  lastPolledAt: integrationConnections.lastPolledAt,
};

export async function getIntegrationConnection(userId: string, id: string) {
  const [connection] = await db.select(integrationConnectionSelection).from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id))).limit(1);
  return connection ?? null;
}

export async function getIntegrationConnectionById(id: string) {
  const [connection] = await db.select(integrationConnectionSelection).from(integrationConnections)
    .where(eq(integrationConnections.id, id)).limit(1);
  return connection ?? null;
}

export async function listIntegrationConnections(userId: string) {
  return db.select(integrationConnectionSelection).from(integrationConnections)
    .where(eq(integrationConnections.userId, userId)).orderBy(desc(integrationConnections.createdAt));
}

export async function saveIntegrationConnection(input: Omit<IntegrationConnection, "lastPolledAt">) {
  await db.insert(integrationConnections).values({ ...input, lastPolledAt: new Date().toISOString() }).onConflictDoUpdate({
    target: [integrationConnections.userId, integrationConnections.provider],
    set: { label: input.label, encryptedCredential: input.encryptedCredential, metadata: input.metadata, status: "connected", lastPolledAt: sql`now()`, updatedAt: sql`now()` },
  });
  const [saved] = await db.select(integrationConnectionSelection).from(integrationConnections)
    .where(and(eq(integrationConnections.userId, input.userId), eq(integrationConnections.provider, input.provider))).limit(1);
  return saved!;
}

export async function disconnectIntegration(connectionId: string) {
  await db.update(integrationConnections).set({ status: "disconnected", encryptedCredential: "", updatedAt: sql`now()` })
    .where(eq(integrationConnections.id, connectionId));
}

export async function markIntegrationReconnect(connectionId: string) {
  await db.update(integrationConnections).set({ status: "needs_reconnect", updatedAt: sql`now()` })
    .where(eq(integrationConnections.id, connectionId));
}

export async function updateIntegrationMetadata(connectionId: string, metadata: Record<string, unknown>) {
  await db.update(integrationConnections).set({ metadata, updatedAt: sql`now()` }).where(eq(integrationConnections.id, connectionId));
}

export async function claimCalendarConnectionForPolling() {
  const rows = await db.execute<IntegrationConnection>(sql`
    WITH next AS (
      SELECT id FROM integration_connections
      WHERE provider = 'google_calendar' AND status = 'connected' AND last_polled_at <= NOW() - INTERVAL '5 minutes'
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.integration_connection_id = integration_connections.id AND tasks.status = 'active'
        )
      ORDER BY last_polled_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE integration_connections i SET last_polled_at = NOW(), updated_at = NOW()
    FROM next WHERE i.id = next.id
    RETURNING i.id, i.user_id AS "userId", i.provider, i.label, i.encrypted_credential AS "encryptedCredential", i.metadata, i.status, i.last_polled_at AS "lastPolledAt"
  `);
  return rows[0] ?? null;
}

export async function persistIntegrationEvent(connection: IntegrationConnection, event: IntegrationEvent) {
  const [stored] = await db.insert(sourceEvents).values({
    id: randomId(), userId: connection.userId, integrationConnectionId: connection.id, kind: "integration.event",
    dedupKey: `integration:${connection.id}:${event.id}`,
    headers: { provider: connection.provider, eventName: event.name }, snippet: event.summary,
    occurredAt: event.occurredAt, processingState: "pending",
  }).onConflictDoNothing({ target: sourceEvents.dedupKey }).returning({ id: sourceEvents.id });
  return stored?.id ?? null;
}

export async function claimIntegrationSourceEvent() {
  const rows = await db.execute<{ id: string; connectionId: string; provider: IntegrationProvider; eventName: string; summary: string; occurredAt: string | null }>(sql`
    WITH next AS (
      SELECT id FROM source_events
      WHERE kind = 'integration.event' AND processing_state = 'pending' AND available_at <= NOW()
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE source_events e SET processing_state = 'processing', attempts = attempts + 1, updated_at = NOW()
    FROM next WHERE e.id = next.id
    RETURNING e.id, e.integration_connection_id AS "connectionId", e.headers->>'provider' AS provider,
      e.headers->>'eventName' AS "eventName", e.snippet AS summary, e.occurred_at AS "occurredAt"
  `);
  return rows[0] ?? null;
}

export async function listActiveIntegrationTasks(connectionId: string) {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt,
    trigger: tasks.trigger, action: tasks.action, activationAt: tasks.activationAt,
  }).from(tasks).where(and(eq(tasks.integrationConnectionId, connectionId), eq(tasks.status, "active")));
  return rows.map((row) => ({ ...row, trigger: row.trigger as IntegrationTaskTrigger, action: row.action as TaskAction }));
}

export async function claimIntegrationTaskRun(input: { taskId: string; eventId: string; requiresApproval: boolean; evidence: unknown }) {
  const [run] = await db.insert(taskRuns).values({
    id: randomId(), taskId: input.taskId, sourceEventId: input.eventId, status: "pending",
    approvalStatus: input.requiresApproval ? "pending" : "not_required", matchingEvidence: input.evidence,
  }).onConflictDoNothing({ target: [taskRuns.taskId, taskRuns.sourceEventId] }).returning({ id: taskRuns.id });
  return run ? { ...run, awaitingApproval: input.requiresApproval } : null;
}

export async function recordCalendarTaskEvent(connection: IntegrationConnection, task: { id: string; action: TaskAction }, event: IntegrationEvent) {
  const [stored] = await db.insert(sourceEvents).values({
    id: randomId(), userId: connection.userId, integrationConnectionId: connection.id, kind: "integration.event",
    dedupKey: `calendar:${connection.id}:${task.id}:${event.id}`,
    headers: { provider: "google_calendar", eventName: event.name }, snippet: event.summary,
    occurredAt: event.occurredAt, processingState: "completed",
  }).onConflictDoNothing({ target: sourceEvents.dedupKey }).returning({ id: sourceEvents.id });
  if (!stored) return null;
  return claimIntegrationTaskRun({ taskId: task.id, eventId: stored.id, requiresApproval: task.action.executionMode === "approval", evidence: [`Calendar event starts at ${event.occurredAt}`, "source:google_calendar"] });
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
  }).onConflictDoUpdate({
    target: [taskRuns.taskId, taskRuns.sourceEventId],
    set: {
      status: "pending",
      attempts: sql`${taskRuns.attempts} + 1`,
      availableAt: sql`now()`,
      error: null,
      providerError: null,
      updatedAt: sql`now()`,
    },
    setWhere: and(
      eq(taskRuns.status, "failed"),
      eq(taskRuns.approvalStatus, "not_required"),
      lte(taskRuns.availableAt, sql`now()`),
    ),
  }).returning({ id: taskRuns.id, attempts: taskRuns.attempts, approvalStatus: taskRuns.approvalStatus });
  return run ? { id: run.id, attempts: run.attempts, awaitingApproval: run.approvalStatus === "pending" } : null;
}

export async function markTaskRunDispatched(runId: string, callId: string) {
  await db.update(taskRuns).set({ status: "calling", callTaskId: callId, error: null, providerError: null, updatedAt: sql`now()` })
    .where(eq(taskRuns.id, runId));
}

export async function markTaskRunFailed(runId: string, error: string, retryAt: Date | null, providerError?: CalleProviderError | null) {
  await db.update(taskRuns).set({
    status: "failed", error, providerError: providerError ?? null, availableAt: retryAt?.toISOString() ?? null, updatedAt: sql`now()`,
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
    sender: sql<string | null>`coalesce(${sourceEvents.headers}->>'from', case when ${sourceEvents.kind} = 'vercel.deployment.failed' then 'Vercel' when ${sourceEvents.kind} = 'notion.page.updated' then 'Notion' when ${sourceEvents.kind} = 'public.signal' then 'Public data' end)`,
    subject: sql<string | null>`coalesce(${sourceEvents.headers}->>'subject', (${sourceEvents.headers}->>'projectName') || ' deployment failed', (${sourceEvents.headers}->>'pageTitle') || ' updated', ${sourceEvents.headers}->>'signal')`,
    snippet: sql<string | null>`coalesce(${sourceEvents.snippet}, ${sourceEvents.headers}->>'gitCommitMessage')`,
    matchingEvidence: taskRuns.matchingEvidence,
    callId: taskRuns.callTaskId,
    result: taskRuns.result,
    error: taskRuns.error,
    providerError: taskRuns.providerError,
    callSource: callTasks.source,
    callSummary: callTasks.summary,
    taskCompleted: callTasks.taskCompleted,
    completionConfidence: callTasks.completionConfidence,
    callEvidence: callTasks.evidence,
    recipients: callTasks.recipients,
    answeredBy: callTasks.answeredBy,
    failureCode: callTasks.failureCode,
    failureMessage: callTasks.failureMessage,
    createdAt: taskRuns.createdAt,
    updatedAt: taskRuns.updatedAt,
  }).from(taskRuns)
    .innerJoin(tasks, eq(tasks.id, taskRuns.taskId))
    .innerJoin(sourceEvents, eq(sourceEvents.id, taskRuns.sourceEventId))
    .leftJoin(callTasks, eq(callTasks.id, taskRuns.callTaskId))
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
  const rows = await db.execute<{ id: string }>(sql`
    WITH next AS (
      SELECT id FROM task_runs
      WHERE approval_status = 'approved' AND (
        status = 'pending' OR (status = 'calling' AND call_task_id IS NULL AND updated_at < NOW() - INTERVAL '10 minutes')
      )
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE task_runs r SET status = 'calling', updated_at = NOW()
    FROM next WHERE r.id = next.id RETURNING r.id
  `);
  const [claimed] = rows;
  if (!claimed) return null;
  const [run] = await db.select({
    id: taskRuns.id, taskId: tasks.id, userId: tasks.userId, originalPrompt: tasks.originalPrompt, trigger: tasks.trigger, action: tasks.action,
    sourceKind: sourceEvents.kind, eventHeaders: sourceEvents.headers, eventSnippet: sourceEvents.snippet,
    gmailMessageId: sourceEvents.gmailMessageId, connectionId: gmailConnections.id, gmailAddress: gmailConnections.gmailAddress,
    encryptedRefreshToken: gmailConnections.encryptedRefreshToken, grantedScopes: gmailConnections.grantedScopes, labelMap: gmailConnections.gmailLabels,
    connectionStatus: gmailConnections.status, historyId: gmailConnections.historyId, watchExpiration: gmailConnections.watchExpiration, lastSyncedAt: gmailConnections.lastSyncedAt,
  }).from(taskRuns).innerJoin(tasks, eq(tasks.id, taskRuns.taskId)).innerJoin(sourceEvents, eq(sourceEvents.id, taskRuns.sourceEventId))
    .leftJoin(gmailConnections, eq(gmailConnections.id, sourceEvents.gmailConnectionId)).where(eq(taskRuns.id, claimed.id)).limit(1);
  return run ?? null;
}

export async function saveCallTask(call: { id: string; userId: string; task: string; phone: string; source: CalleSource; status: string; taskRunId?: string }) {
  await db.insert(callTasks).values({ ...call, taskRunId: call.taskRunId ?? null }).onConflictDoNothing({ target: callTasks.id });
}

export async function reserveCallDispatch(userId: string, eventId: string, dailyLimit: number) {
  const eventKey = `${userId}:${eventId}`;
  const rows = await db.execute<{ eventKey: string }>(sql`
    WITH locked AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    ), existing AS (
      SELECT event_key FROM call_dispatch_reservations WHERE event_key = ${eventKey}
    ), inserted AS (
      INSERT INTO call_dispatch_reservations (event_key, user_id)
      SELECT ${eventKey}, ${userId} FROM locked
      WHERE NOT EXISTS (SELECT 1 FROM existing)
        AND (SELECT COUNT(*) FROM call_dispatch_reservations WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '24 hours') < ${dailyLimit}
      ON CONFLICT DO NOTHING
      RETURNING event_key
    )
    SELECT event_key AS "eventKey" FROM existing
    UNION ALL
    SELECT event_key AS "eventKey" FROM inserted
    LIMIT 1
  `);
  return rows.length > 0;
}

export async function hasCallDispatchCapacity(userId: string, dailyLimit: number) {
  const rows = await db.execute<{ allowed: boolean }>(sql`
    SELECT (COUNT(*) < ${dailyLimit}) AS allowed
    FROM call_dispatch_reservations
    WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '24 hours'
  `);
  return rows[0]?.allowed ?? false;
}

export async function updateCallTask(call: {
  id: string;
  status: string;
  summary?: string | null;
  result?: unknown;
  taskCompleted?: boolean | null;
  completionConfidence?: CalleCompletionConfidence | null;
  evidence?: string[];
  recipients?: CalleCallRecipient[];
  answeredBy?: CalleAnsweredBy | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  providerEventId?: string | null;
  completedAt?: string | null;
  queueEmailReply?: boolean;
}) {
  const recipient = call.recipients?.[0];
  const terminalFailure = call.status === "failed" || call.status === "canceled";
  await db.transaction(async (tx) => {
    await tx.update(callTasks).set({
      status: call.status,
      summary: call.summary ?? null,
      result: call.result ?? null,
      taskCompleted: call.taskCompleted ?? null,
      completionConfidence: call.completionConfidence ?? null,
      evidence: call.evidence ?? [],
      recipients: call.recipients ?? [],
      answeredBy: call.answeredBy ?? null,
      region: recipient?.region ?? null,
      locale: recipient?.locale ?? null,
      failureCode: call.failureCode ?? null,
      failureMessage: call.failureMessage ?? null,
      providerEventId: call.providerEventId ?? null,
      completedAt: call.completedAt ?? null,
      updatedAt: sql`now()`,
    }).where(eq(callTasks.id, call.id));
    await tx.update(taskRuns).set({
      status: call.status === "completed" ? "completed" : terminalFailure ? "failed" : "calling",
      result: call.result ?? null,
      error: terminalFailure ? call.failureMessage ?? call.failureCode ?? "CALL-E call failed" : null,
      providerError: terminalFailure ? {
        status: null,
        code: call.failureCode ?? "call_failed",
        message: call.failureMessage ?? "CALL-E call failed",
        details: {},
        retryAfterSeconds: null,
      } : null,
      updatedAt: sql`now()`,
    }).where(eq(taskRuns.callTaskId, call.id));
    if (call.queueEmailReply) {
      await tx.update(callTasks).set({ replyStatus: "pending", replyError: null, updatedAt: sql`now()` })
        .where(and(
          eq(callTasks.id, call.id),
          eq(callTasks.replyStatus, "not_requested"),
          sql`exists (
            select 1 from task_runs tr join tasks t on t.id = tr.task_id
            where tr.id = ${callTasks.taskRunId} and t.trigger->>'type' = 'email.received'
          )`,
        ));
    }
  });
}

export async function getStoredCallTask(id: string) {
  const [call] = await db.select({ id: callTasks.id, status: callTasks.status }).from(callTasks).where(eq(callTasks.id, id)).limit(1);
  return call ?? null;
}

export type PendingEmailReply = {
  callId: string;
  result: unknown;
  completionConfidence: CalleCompletionConfidence | null;
  answeredBy: CalleAnsweredBy | null;
  taskCompleted: boolean | null;
  instruction: string;
  originalPrompt: string;
  gmailConnection: GmailConnection;
  gmailMessageId: string;
};

export async function claimPendingEmailReply(): Promise<PendingEmailReply | null> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH next AS (
      SELECT id FROM call_tasks
      WHERE reply_status = 'pending' AND reply_message_id IS NULL
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE call_tasks c SET reply_status = 'sending', updated_at = NOW()
    FROM next WHERE c.id = next.id RETURNING c.id
  `);
  const [claimed] = rows;
  if (!claimed) return null;

  const [reply] = await db.select({
    callId: callTasks.id,
    result: callTasks.result,
    completionConfidence: callTasks.completionConfidence,
    answeredBy: callTasks.answeredBy,
    taskCompleted: callTasks.taskCompleted,
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
    completionConfidence: reply.completionConfidence,
    answeredBy: reply.answeredBy as CalleAnsweredBy | null,
    taskCompleted: reply.taskCompleted,
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
    source: callTasks.source,
    region: callTasks.region,
    locale: callTasks.locale,
    status: callTasks.status,
    summary: callTasks.summary,
    result: callTasks.result,
    taskCompleted: callTasks.taskCompleted,
    completionConfidence: callTasks.completionConfidence,
    evidence: callTasks.evidence,
    recipients: callTasks.recipients,
    answeredBy: callTasks.answeredBy,
    failureCode: callTasks.failureCode,
    failureMessage: callTasks.failureMessage,
    providerEventId: callTasks.providerEventId,
    completedAt: callTasks.completedAt,
    createdAt: callTasks.createdAt,
    updatedAt: callTasks.updatedAt,
  }).from(callTasks).where(eq(callTasks.userId, userId)).orderBy(desc(callTasks.createdAt));
}
