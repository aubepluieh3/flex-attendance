ALTER TABLE "work_sessions" ADD COLUMN "closed_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD COLUMN "closed_note" text DEFAULT '' NOT NULL;