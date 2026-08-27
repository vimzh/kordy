CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_provider_check" CHECK ("provider" in ('github', 'stripe', 'google_calendar', 'n8n')),
	CONSTRAINT "integration_connections_status_check" CHECK ("status" in ('connected', 'needs_reconnect', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "source_events" ADD COLUMN "integration_connection_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "integration_connection_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_user_provider_key" ON "integration_connections" ("user_id","provider");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_PB9z9VzWDS58_fkey" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_integration_connection_id_integration_connections_id_fkey" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "source_events" DROP CONSTRAINT "source_events_kind_check", ADD CONSTRAINT "source_events_kind_check" CHECK ("kind" in ('gmail.notification', 'gmail.message', 'vercel.deployment.failed', 'notion.page.updated', 'public.signal', 'integration.event'));