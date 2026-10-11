CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_code" varchar(32) NOT NULL,
	"amount_xaf" integer NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"external_reference" uuid NOT NULL,
	"provider_reference" varchar(64),
	"phone_hmac" char(64) NOT NULL,
	"phone_suffix" char(2) NOT NULL,
	"status" varchar(16) NOT NULL,
	"confirmed_via" varchar(8),
	"failure_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payments_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "payments_external_reference_key" UNIQUE("external_reference"),
	CONSTRAINT "payments_provider_reference_key" UNIQUE("provider","provider_reference"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_xaf" > 0),
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" in ('fake', 'campay')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('pending', 'succeeded', 'failed', 'expired', 'amount_mismatch')),
	CONSTRAINT "payments_confirmed_via_check" CHECK ("payments"."confirmed_via" is null or "payments"."confirmed_via" in ('webhook', 'sweep')),
	CONSTRAINT "payments_completed_check" CHECK (("payments"."status" = 'pending') = ("payments"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_pending_created_at_idx" ON "payments" USING btree ("created_at") WHERE "payments"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payments_user_id_created_at_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_phone_hmac_created_at_idx" ON "payments" USING btree ("phone_hmac","created_at");