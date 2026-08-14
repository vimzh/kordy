CREATE TABLE "vercel_connections" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"account_slug" text NOT NULL,
	"team_id" text,
	"encrypted_access_token" text NOT NULL,
	"projects" jsonb DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vercel_connections_status_check" CHECK ("status" in ('connected', 'needs_reconnect', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "source_events" ADD COLUMN "vercel_connection_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "vercel_connection_id" text;--> statement-breakpoint
ALTER TABLE "source_events" ALTER COLUMN "gmail_connection_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vercel_connections_user_account_key" ON "vercel_connections" ("user_id","account_id");--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_vercel_connection_id_vercel_connections_id_fkey" FOREIGN KEY ("vercel_connection_id") REFERENCES "vercel_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_vercel_connection_id_vercel_connections_id_fkey" FOREIGN KEY ("vercel_connection_id") REFERENCES "vercel_connections"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "vercel_connections" ADD CONSTRAINT "vercel_connections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_events" DROP CONSTRAINT "source_events_kind_check", ADD CONSTRAINT "source_events_kind_check" CHECK ("kind" in ('gmail.notification', 'gmail.message', 'vercel.deployment.failed'));
