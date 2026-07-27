CREATE TYPE "public"."session_source" AS ENUM('app', 'import', 'manual');--> statement-breakpoint
ALTER TYPE "public"."work_day_status" ADD VALUE 'open';--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" "session_source" DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_days" ADD COLUMN "session_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_days" ADD COLUMN "open_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_sessions_user_date" ON "work_sessions" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "work_sessions_open" ON "work_sessions" USING btree ("user_id","ended_at");