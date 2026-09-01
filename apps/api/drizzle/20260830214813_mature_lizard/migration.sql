ALTER TABLE "call_tasks" ADD COLUMN "reconciliation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "reconcile_available_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "call_tasks" ADD COLUMN "provider_error" jsonb;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "approval_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "approval_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "approval_decided_by" text;--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "approval_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "name" varchar(120);--> statement-breakpoint
UPDATE "tasks" SET "name" = LEFT("original_prompt", 120) WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parser_confidence" real;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parser_ambiguity" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delivery" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval_expiry_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
UPDATE "task_runs" r SET "approval_expires_at" = r."created_at" + make_interval(mins => u."approval_expiry_minutes") FROM "tasks" t JOIN "users" u ON u."id" = t."user_id" WHERE r."task_id" = t."id" AND r."approval_status" = 'pending' AND r."approval_expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_approval_decided_by_users_id_fkey" FOREIGN KEY ("approval_decided_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_status_check", ADD CONSTRAINT "tasks_status_check" CHECK ("status" in ('creating', 'parsing', 'draft', 'active', 'needs_clarification', 'paused', 'archived', 'parse_failed'));
