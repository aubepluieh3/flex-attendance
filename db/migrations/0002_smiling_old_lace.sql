-- NOT NULL 로 바꾸기 전에 기존 NULL 을 채운다
UPDATE "attendance_logs" SET "device_label" = '' WHERE "device_label" IS NULL;--> statement-breakpoint
ALTER TABLE "attendance_logs" ALTER COLUMN "device_label" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "attendance_logs" ALTER COLUMN "device_label" SET NOT NULL;