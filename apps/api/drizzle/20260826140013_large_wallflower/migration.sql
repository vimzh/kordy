CREATE TABLE "call_dispatch_reservations" (
	"event_key" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "call_dispatch_reservations_user_created_idx" ON "call_dispatch_reservations" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "call_dispatch_reservations" ADD CONSTRAINT "call_dispatch_reservations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;