CREATE TABLE "notion_connections" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_name" text NOT NULL,
	"workspace_icon" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"pages" jsonb DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notion_connections_status_check" CHECK ("status" in ('connected', 'needs_reconnect', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "source_events" ADD COLUMN "notion_connection_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notion_connection_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notion_connections_user_workspace_key" ON "notion_connections" ("user_id","workspace_id");--> statement-breakpoint
ALTER TABLE "notion_connections" ADD CONSTRAINT "notion_connections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_notion_connection_id_notion_connections_id_fkey" FOREIGN KEY ("notion_connection_id") REFERENCES "notion_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_notion_connection_id_notion_connections_id_fkey" FOREIGN KEY ("notion_connection_id") REFERENCES "notion_connections"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "source_events" DROP CONSTRAINT "source_events_kind_check", ADD CONSTRAINT "source_events_kind_check" CHECK ("kind" in ('gmail.notification', 'gmail.message', 'vercel.deployment.failed', 'notion.page.updated'));