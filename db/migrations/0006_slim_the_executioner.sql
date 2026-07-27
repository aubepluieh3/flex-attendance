CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_no" text NOT NULL,
	"ip" text,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_attempts_employee" ON "login_attempts" USING btree ("employee_no","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip" ON "login_attempts" USING btree ("ip","created_at");