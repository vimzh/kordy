ALTER TABLE "call_tasks" ADD COLUMN "source" varchar(30) DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "region" varchar(2);--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "locale" varchar(35);--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "task_completed" boolean;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "completion_confidence" jsonb;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "evidence" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "recipients" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "answered_by" varchar(20);--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "provider_event_id" text;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "provider_error" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "call_region" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "call_locale" varchar(35);