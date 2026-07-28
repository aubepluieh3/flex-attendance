DROP INDEX "notifications_user_unread";--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "read_at";