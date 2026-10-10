CREATE TABLE "otp_dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" varchar(8) NOT NULL,
	"destination_key" char(64) NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "otp_dispatches_channel_check" CHECK ("otp_dispatches"."channel" in ('email', 'sms'))
);
--> statement-breakpoint
CREATE INDEX "otp_dispatches_destination_idx" ON "otp_dispatches" USING btree ("destination_key","sent_at");--> statement-breakpoint
CREATE INDEX "otp_dispatches_channel_idx" ON "otp_dispatches" USING btree ("channel","sent_at");