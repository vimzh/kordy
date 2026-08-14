import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
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

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  originalPrompt: text("original_prompt").notNull(),
  status: text("status").$type<"creating" | "parsing" | "active" | "needs_clarification" | "paused" | "archived" | "parse_failed">().notNull(),
  schemaVersion: integer("schema_version").default(1).notNull(),
  gmailConnectionId: text("gmail_connection_id").references(() => gmailConnections.id, { onDelete: "set null" }),
  trigger: jsonb("trigger"),
  action: jsonb("action"),
  clarificationQuestion: text("clarification_question"),
  clarificationContext: jsonb("clarification_context"),
  parserModel: text("parser_model").notNull(),
  executionMode: text("execution_mode").$type<"automatic" | "approval">().default("automatic").notNull(),
  activationAt: timestamp("activation_at", { withTimezone: true, mode: "string" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("tasks_user_id_request_id_key").on(table.userId, table.requestId),
  check("tasks_status_check", sql`${table.status} in ('creating', 'parsing', 'active', 'needs_clarification', 'paused', 'archived', 'parse_failed')`),
]);

export const sourceEvents = pgTable("source_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gmailConnectionId: text("gmail_connection_id").notNull().references(() => gmailConnections.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"gmail.notification" | "gmail.message">().notNull(),
  pubsubMessageId: text("pubsub_message_id"),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  historyId: text("history_id"),
  dedupKey: text("dedup_key").notNull().unique(),
  headers: jsonb("headers").$type<{ from?: string; subject?: string }>(),
  snippet: text("snippet"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }),
  processingState: text("processing_state").$type<"pending" | "processing" | "completed" | "failed">().default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }).defaultNow(),
  error: text("error"),
  ...timestamps,
}, (table) => [
  index("source_events_queue_idx").on(table.processingState, table.availableAt),
  check("source_events_kind_check", sql`${table.kind} in ('gmail.notification', 'gmail.message')`),
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
  approvalStatus: varchar("approval_status", { length: 20 }).default("not_required").notNull(),
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
  status: varchar("status", { length: 40 }).notNull(),
  summary: text("summary"),
  result: jsonb("result"),
  taskRunId: text("task_run_id").references(() => taskRuns.id, { onDelete: "set null" }),
  replyStatus: varchar("reply_status", { length: 20 }).default("not_requested").notNull(),
  replyMessageId: text("reply_message_id"),
  replyError: text("reply_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("call_tasks_run_key").on(table.taskRunId).where(sql`${table.taskRunId} is not null`),
]);
