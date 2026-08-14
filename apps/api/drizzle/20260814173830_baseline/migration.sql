CREATE TABLE "call_tasks" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"task" text NOT NULL,
	"phone" varchar(16) NOT NULL,
	"status" varchar(40) NOT NULL,
	"summary" text,
	"result" jsonb,
	"task_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" bigserial PRIMARY KEY,
	"user_id" text,
	"name" varchar(100) NOT NULL,
	"summary" varchar(200) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"user_id" text PRIMARY KEY,
	"gmail_address" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"gmail_labels" jsonb DEFAULT '{}' NOT NULL,
	"status" text NOT NULL,
	"history_id" text,
	"watch_expiration" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connections_status_check" CHECK ("status" in ('connected', 'needs_reconnect', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"gmail_connection_id" text NOT NULL,
	"kind" text NOT NULL,
	"pubsub_message_id" text,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"history_id" text,
	"dedup_key" text NOT NULL UNIQUE,
	"headers" jsonb,
	"snippet" text,
	"occurred_at" timestamp with time zone,
	"processing_state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now(),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_events_kind_check" CHECK ("kind" in ('gmail.notification', 'gmail.message')),
	CONSTRAINT "source_events_processing_state_check" CHECK ("processing_state" in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"status" text NOT NULL,
	"matching_evidence" jsonb,
	"call_task_id" text,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_runs_status_check" CHECK ("status" in ('pending', 'calling', 'completed', 'failed', 'not_matched'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"original_prompt" text NOT NULL,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"gmail_connection_id" text,
	"trigger" jsonb,
	"action" jsonb,
	"clarification_question" text,
	"clarification_context" jsonb,
	"parser_model" text NOT NULL,
	"activation_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("status" in ('active', 'needs_clarification', 'paused', 'archived', 'parse_failed'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL,
	"name" text,
	"picture" text,
	"default_phone" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "call_tasks_run_key" ON "call_tasks" ("task_run_id") WHERE "task_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_phone_key" ON "contacts" ("user_id","phone");--> statement-breakpoint
CREATE INDEX "source_events_queue_idx" ON "source_events" ("processing_state","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_task_id_source_event_id_key" ON "task_runs" ("task_id","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_id_request_id_key" ON "tasks" ("user_id","request_id");--> statement-breakpoint
ALTER TABLE "call_tasks" ADD CONSTRAINT "call_tasks_task_run_id_task_runs_id_fkey" FOREIGN KEY ("task_run_id") REFERENCES "task_runs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_D7s9YT3WkC8U_fkey" FOREIGN KEY ("gmail_connection_id") REFERENCES "gmail_connections"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_source_event_id_source_events_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "source_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_gmail_connection_id_gmail_connections_user_id_fkey" FOREIGN KEY ("gmail_connection_id") REFERENCES "gmail_connections"("user_id") ON DELETE SET NULL;