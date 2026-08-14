ALTER TABLE "source_events" DROP CONSTRAINT "source_events_D7s9YT3WkC8U_fkey";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_gmail_connection_id_gmail_connections_user_id_fkey";--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "gmail_connections" SET "id" = "user_id" WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "gmail_connections" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_connections" DROP CONSTRAINT "gmail_connections_pkey";--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_connections_user_address_key" ON "gmail_connections" ("user_id","gmail_address");--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_gmail_connection_id_gmail_connections_id_fkey" FOREIGN KEY ("gmail_connection_id") REFERENCES "gmail_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_gmail_connection_id_gmail_connections_id_fkey" FOREIGN KEY ("gmail_connection_id") REFERENCES "gmail_connections"("id") ON DELETE SET NULL;
