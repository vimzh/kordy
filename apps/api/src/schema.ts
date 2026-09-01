import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  defaultPhone: varchar("default_phone", { length: 16 }),
  outboundCallConsentAt: timestamp("outbound_call_consent_at", { withTimezone: true, mode: "string" }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true, mode: "string" }),
  callRegion: varchar("call_region", { length: 2 }),
  callLocale: varchar("call_locale", { length: 35 }),
  approvalExpiryMinutes: integer("approval_expiry_minutes").default(60).notNull(),
  ...timestamps,
});

export const contacts = pgTable("contacts", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  summary: varchar("summary", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: text("email"),
  createdAt: timestamps.createdAt,
}, (table) => [
  uniqueIndex("contacts_user_phone_key").on(table.userId, table.phone),
]);

export const gmailConnections = pgTable("gmail_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gmailAddress: text("gmail_address").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  grantedScopes: text("granted_scopes").array().default(sql`'{}'::text[]`).notNull(),
  gmailLabels: jsonb("gmail_labels").$type<Record<string, string>>().default({}).notNull(),
  status: text("status").$type<"connected" | "needs_reconnect" | "disconnected">().notNull(),
  historyId: text("history_id"),
  watchExpiration: timestamp("watch_expiration", { withTimezone: true, mode: "string" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "string" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("gmail_connections_user_address_key").on(table.userId, table.gmailAddress),
  check("gmail_connections_status_check", sql`${table.status} in ('connected', 'needs_reconnect', 'disconnected')`),
]);

export const vercelConnections = pgTable("vercel_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  accountName: text("account_name").notNull(),
  accountSlug: text("account_slug").notNull(),
  teamId: text("team_id"),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  projects: jsonb("projects").$type<Array<{ id: string; name: string }>>().default([]).notNull(),
  status: text("status").$type<"connected" | "needs_reconnect" | "disconnected">().notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("vercel_connections_user_account_key").on(table.userId, table.accountId),
  check("vercel_connections_status_check", sql`${table.status} in ('connected', 'needs_reconnect', 'disconnected')`),
]);

export const notionConnections = pgTable("notion_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  workspaceName: text("workspace_name").notNull(),
  workspaceIcon: text("workspace_icon"),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  pages: jsonb("pages").$type<Array<{ id: string; title: string; url: string }>>().default([]).notNull(),
  status: text("status").$type<"connected" | "needs_reconnect" | "disconnected">().notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("notion_connections_user_workspace_key").on(table.userId, table.workspaceId),
  check("notion_connections_status_check", sql`${table.status} in ('connected', 'needs_reconnect', 'disconnected')`),
]);

export const integrationConnections = pgTable("integration_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"github" | "stripe" | "google_calendar" | "n8n">().notNull(),
  label: text("label").notNull(),
  encryptedCredential: text("encrypted_credential").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").$type<"connected" | "needs_reconnect" | "disconnected">().notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("integration_connections_user_provider_key").on(table.userId, table.provider),
  check("integration_connections_provider_check", sql`${table.provider} in ('github', 'stripe', 'google_calendar', 'n8n')`),
  check("integration_connections_status_check", sql`${table.status} in ('connected', 'needs_reconnect', 'disconnected')`),
]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  originalPrompt: text("original_prompt").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  status: text("status").$type<"creating" | "parsing" | "draft" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed">().notNull(),
  schemaVersion: integer("schema_version").default(1).notNull(),
  gmailConnectionId: text("gmail_connection_id").references(() => gmailConnections.id, { onDelete: "set null" }),
  vercelConnectionId: text("vercel_connection_id").references(() => vercelConnections.id, { onDelete: "set null" }),
  notionConnectionId: text("notion_connection_id").references(() => notionConnections.id, { onDelete: "set null" }),
  integrationConnectionId: text("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  trigger: jsonb("trigger"),
  action: jsonb("action"),
  publicSourceState: jsonb("public_source_state").$type<{ matched: boolean; fingerprint: string }>(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "string" }),
  clarificationQuestion: text("clarification_question"),
  clarificationContext: jsonb("clarification_context"),
  parserModel: text("parser_model").notNull(),
  parserConfidence: real("parser_confidence"),
  parserAmbiguity: text("parser_ambiguity"),
  delivery: jsonb("delivery").$type<{
    timezone?: string;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    cooldownMinutes?: number;
    maxCallsPerHour?: number;
    maxCallsPerDay?: number;
    startsAt?: string;
    expiresAt?: string;
    locale?: string;
    region?: string;
  }>().default({}).notNull(),
  executionMode: text("execution_mode").$type<"automatic" | "approval">().default("automatic").notNull(),
  activationAt: timestamp("activation_at", { withTimezone: true, mode: "string" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("tasks_user_id_request_id_key").on(table.userId, table.requestId),
  check("tasks_status_check", sql`${table.status} in ('creating', 'parsing', 'draft', 'active', 'needs_clarification', 'paused', 'archived', 'parse_failed')`),
]);

export const sourceEvents = pgTable("source_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gmailConnectionId: text("gmail_connection_id").references(() => gmailConnections.id, { onDelete: "cascade" }),
  vercelConnectionId: text("vercel_connection_id").references(() => vercelConnections.id, { onDelete: "cascade" }),
  notionConnectionId: text("notion_connection_id").references(() => notionConnections.id, { onDelete: "cascade" }),
  integrationConnectionId: text("integration_connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"gmail.notification" | "gmail.message" | "vercel.deployment.failed" | "notion.page.updated" | "public.signal" | "integration.event">().notNull(),
  pubsubMessageId: text("pubsub_message_id"),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  historyId: text("history_id"),
  dedupKey: text("dedup_key").notNull().unique(),
  headers: jsonb("headers").$type<{
    from?: string;
    subject?: string;
    deploymentId?: string;
    projectId?: string;
    projectName?: string;
    target?: "production" | "preview" | null;
    url?: string;
    gitCommitMessage?: string | null;
    pageId?: string;
    pageTitle?: string;
    pageUrl?: string;
    provider?: string;
    signal?: string;
    eventName?: string;
  }>(),
  snippet: text("snippet"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }),
  processingState: text("processing_state").$type<"pending" | "processing" | "completed" | "failed">().default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }).defaultNow(),
  error: text("error"),
  ...timestamps,
}, (table) => [
  index("source_events_queue_idx").on(table.processingState, table.availableAt),
  check("source_events_kind_check", sql`${table.kind} in ('gmail.notification', 'gmail.message', 'vercel.deployment.failed', 'notion.page.updated', 'public.signal', 'integration.event')`),
  check("source_events_processing_state_check", sql`${table.processingState} in ('pending', 'processing', 'completed', 'failed')`),
]);

export const taskRuns = pgTable("task_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  sourceEventId: text("source_event_id").notNull().references(() => sourceEvents.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "calling" | "completed" | "failed" | "not_matched">().notNull(),
  matchingEvidence: jsonb("matching_evidence"),
  callTaskId: text("call_task_id"),
  result: jsonb("result"),
  error: text("error"),
  providerError: jsonb("provider_error").$type<{
    status: number | null;
    code: string;
    message: string;
    details: Record<string, unknown>;
    retryAfterSeconds: number | null;
  }>(),
  approvalStatus: varchar("approval_status", { length: 20 }).default("not_required").notNull(),
  approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true, mode: "string" }),
  approvalDecidedAt: timestamp("approval_decided_at", { withTimezone: true, mode: "string" }),
  approvalDecidedBy: text("approval_decided_by").references(() => users.id, { onDelete: "set null" }),
  approvalViewedAt: timestamp("approval_viewed_at", { withTimezone: true, mode: "string" }),
  attempts: integer("attempts").default(0).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }).defaultNow(),
  ...timestamps,
}, (table) => [
  uniqueIndex("task_runs_task_id_source_event_id_key").on(table.taskId, table.sourceEventId),
  check("task_runs_status_check", sql`${table.status} in ('pending', 'calling', 'completed', 'failed', 'not_matched')`),
]);

export const callTasks = pgTable("call_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  task: text("task").notNull(),
  phone: varchar("phone", { length: 16 }).notNull(),
  source: varchar("source", { length: 30 }).default("generic").notNull(),
  region: varchar("region", { length: 2 }),
  locale: varchar("locale", { length: 35 }),
  status: varchar("status", { length: 40 }).notNull(),
  summary: text("summary"),
  result: jsonb("result"),
  taskCompleted: boolean("task_completed"),
  completionConfidence: jsonb("completion_confidence").$type<{ score: number; label: string }>(),
  evidence: jsonb("evidence").$type<string[]>().default([]).notNull(),
  recipients: jsonb("recipients").$type<unknown[]>().default([]).notNull(),
  answeredBy: varchar("answered_by", { length: 20 }),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  providerEventId: text("provider_event_id"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  taskRunId: text("task_run_id").references(() => taskRuns.id, { onDelete: "set null" }),
  replyStatus: varchar("reply_status", { length: 20 }).default("not_requested").notNull(),
  replyMessageId: text("reply_message_id"),
  replyError: text("reply_error"),
  reconciliationAttempts: integer("reconciliation_attempts").default(0).notNull(),
  reconcileAvailableAt: timestamp("reconcile_available_at", { withTimezone: true, mode: "string" }).defaultNow(),
  providerError: jsonb("provider_error").$type<{
    status: number | null;
    code: string;
    message: string;
    details: Record<string, unknown>;
    retryAfterSeconds: number | null;
  }>(),
  ...timestamps,
}, (table) => [
  uniqueIndex("call_tasks_run_key").on(table.taskRunId).where(sql`${table.taskRunId} is not null`),
]);

export const callDispatchReservations = pgTable("call_dispatch_reservations", {
  eventKey: text("event_key").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamps.createdAt,
}, (table) => [
  index("call_dispatch_reservations_user_created_idx").on(table.userId, table.createdAt),
]);
