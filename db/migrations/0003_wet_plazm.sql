DROP INDEX "period_snapshots_period_user";--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "period_snapshots_period_user" ON "period_snapshots" USING btree ("period_id","user_id","captured_at");