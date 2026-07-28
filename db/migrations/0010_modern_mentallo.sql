CREATE TYPE "public"."time_off_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
DROP INDEX "time_off_user_date";--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "status" time_off_status DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "decision_note" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- 기존 행은 HR이 직접 넣은 것이므로 승인된 휴가다.
-- 백필하지 않으면 전부 pending 이 되어 이미 반영돼 있던 소정근로 차감이
-- 조용히 사라진다. requested_by 는 NOT NULL 이라 채운 뒤에 제약을 건다.
UPDATE "time_off" SET
  "status" = 'approved',
  "requested_by" = "created_by",
  "decided_by" = "created_by",
  "decided_at" = "created_at"
WHERE "requested_by" IS NULL;--> statement-breakpoint
ALTER TABLE "time_off" ALTER COLUMN "requested_by" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "time_off" ADD CONSTRAINT "time_off_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_off_status" ON "time_off" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "time_off_user_date" ON "time_off" USING btree ("user_id","date") WHERE "time_off"."status" <> 'rejected';
