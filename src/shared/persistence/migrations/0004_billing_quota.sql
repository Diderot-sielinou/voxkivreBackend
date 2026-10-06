CREATE TABLE "quota_reservations" (
	"reservation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" varchar(7) NOT NULL,
	"chars" bigint NOT NULL,
	"refunded_chars" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "quota_reservations_chars_check" CHECK ("quota_reservations"."chars" > 0),
	CONSTRAINT "quota_reservations_refund_check" CHECK ("quota_reservations"."refunded_chars" is null or ("quota_reservations"."refunded_chars" >= 0 and "quota_reservations"."refunded_chars" <= "quota_reservations"."chars"))
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"user_id" text NOT NULL,
	"period" varchar(7) NOT NULL,
	"reserved_chars" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quota_usage_user_id_period_pk" PRIMARY KEY("user_id","period"),
	CONSTRAINT "quota_usage_reserved_chars_check" CHECK ("quota_usage"."reserved_chars" >= 0)
);
--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;