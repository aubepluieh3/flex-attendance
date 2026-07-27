CREATE TYPE "public"."access_resource" AS ENUM('work_days', 'adjustments', 'summary', 'export');--> statement-breakpoint
CREATE TYPE "public"."access_scope" AS ENUM('self', 'user', 'team', 'org');--> statement-breakpoint
CREATE TYPE "public"."adjustment_kind" AS ENUM('field_work', 'missing_tag', 'correction', 'revert');--> statement-breakpoint
CREATE TYPE "public"."log_direction" AS ENUM('in', 'out', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."log_source" AS ENUM('import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."period_close_action" AS ENUM('close', 'reopen');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."settlement_period" AS ENUM('week', 'month');--> statement-breakpoint
CREATE TYPE "public"."time_off_kind" AS ENUM('full', 'half_am', 'half_pm', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'manager', 'hr', 'executive');--> statement-breakpoint
CREATE TYPE "public"."work_day_status" AS ENUM('computed', 'adjusted', 'incomplete');--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"scope" "access_scope" NOT NULL,
	"resource" "access_resource" NOT NULL,
	"target_user_id" uuid,
	"target_team_id" uuid,
	"period_start" date,
	"period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"device_label" text,
	"direction" "log_direction" DEFAULT 'unknown' NOT NULL,
	"source" "log_source" DEFAULT 'import' NOT NULL,
	"import_batch_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" "adjustment_kind" NOT NULL,
	"override_first_in_at" timestamp with time zone,
	"override_last_out_at" timestamp with time zone,
	"added_minutes" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"settlement_period" "settlement_period" DEFAULT 'week' NOT NULL,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"target_minutes_per_period" integer DEFAULT 2400 NOT NULL,
	"limit_minutes_per_week" integer DEFAULT 3120 NOT NULL,
	"standard_minutes_per_day" integer DEFAULT 480 NOT NULL,
	"break_rules" jsonb DEFAULT '[{"overHours":4,"deductMinutes":30},{"overHours":8,"deductMinutes":60}]'::jsonb NOT NULL,
	"day_boundary_hour" integer DEFAULT 5 NOT NULL,
	"core_time_start" text,
	"core_time_end" text,
	"flex_band_start" text,
	"flex_band_end" text,
	"night_window_start" text DEFAULT '22:00' NOT NULL,
	"night_window_end" text DEFAULT '06:00' NOT NULL,
	"daily_limit_minutes" integer DEFAULT 720,
	"weekend_days" jsonb DEFAULT '[6,7]'::jsonb NOT NULL,
	"review_threshold_minutes" integer DEFAULT 480 NOT NULL,
	"close_grace_days" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_close_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"action" "period_close_action" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_minutes" integer NOT NULL,
	"worked_minutes" integer NOT NULL,
	"night_minutes" integer NOT NULL,
	"holiday_minutes" integer NOT NULL,
	"overtime_minutes" integer NOT NULL,
	"avg_weekly_minutes" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" time_off_kind NOT NULL,
	"deduct_minutes" integer NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"employee_no" text NOT NULL,
	"external_id" text,
	"team_id" uuid,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"first_in_at" timestamp with time zone,
	"last_out_at" timestamp with time zone,
	"stay_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"work_minutes" integer DEFAULT 0 NOT NULL,
	"night_minutes" integer DEFAULT 0 NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "work_day_status" DEFAULT 'computed' NOT NULL,
	"tag_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_events" ADD CONSTRAINT "period_close_events_period_id_settlement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."settlement_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_events" ADD CONSTRAINT "period_close_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_period_id_settlement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."settlement_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD CONSTRAINT "settlement_periods_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_parent_id_teams_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_logs_actor" ON "access_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "access_logs_target" ON "access_logs" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_logs_dedupe" ON "attendance_logs" USING btree ("user_id","occurred_at","device_label");--> statement-breakpoint
CREATE INDEX "attendance_logs_user_time" ON "attendance_logs" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "day_adjustments_user_date" ON "day_adjustments" USING btree ("user_id","work_date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_org_date" ON "holidays" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "period_close_events_period" ON "period_close_events" USING btree ("period_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "period_snapshots_period_user" ON "period_snapshots" USING btree ("period_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_periods_org_start" ON "settlement_periods" USING btree ("org_id","period_start");--> statement-breakpoint
CREATE INDEX "teams_org_parent" ON "teams" USING btree ("org_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_off_user_date" ON "time_off" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_employee_no" ON "users" USING btree ("org_id","employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "work_days_user_date" ON "work_days" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "work_days_org_date" ON "work_days" USING btree ("org_id","work_date");