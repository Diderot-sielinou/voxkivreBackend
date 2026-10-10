CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(12) NOT NULL,
	"units" bigint NOT NULL,
	"offer_code" varchar(32),
	"reservation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credit_entries_kind_check" CHECK ("credit_entries"."kind" in ('purchase', 'consumption', 'refund')),
	CONSTRAINT "credit_entries_units_check" CHECK ("credit_entries"."units" <> 0)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"kind" varchar(8) NOT NULL,
	"price_xaf" integer NOT NULL,
	"units" bigint NOT NULL,
	"duration_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_kind_check" CHECK ("offers"."kind" in ('pass', 'credits')),
	CONSTRAINT "offers_price_check" CHECK ("offers"."price_xaf" >= 0),
	CONSTRAINT "offers_units_check" CHECK ("offers"."units" > 0),
	CONSTRAINT "offers_duration_check" CHECK (("offers"."kind" = 'pass') = ("offers"."duration_days" is not null and "offers"."duration_days" > 0))
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payment_reference" varchar(128) NOT NULL,
	"offer_code" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"included_units" bigint NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "passes_payment_reference_key" UNIQUE("payment_reference"),
	CONSTRAINT "passes_period_check" CHECK ("passes"."ends_at" > "passes"."starts_at"),
	CONSTRAINT "passes_units_check" CHECK ("passes"."used_units" >= 0 and "passes"."used_units" <= "passes"."included_units")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"payment_reference" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_code" varchar(32) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"price_xaf" integer NOT NULL,
	"units" bigint NOT NULL,
	"granted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallets_balance_check" CHECK ("wallets"."balance_units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "tier" varchar(8) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "pass_id" uuid;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "free_units" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "pass_units" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "credit_units" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_payment_reference_purchases_payment_reference_fk" FOREIGN KEY ("payment_reference") REFERENCES "public"."purchases"("payment_reference") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_offer_code_offers_code_fk" FOREIGN KEY ("offer_code") REFERENCES "public"."offers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_entries_user_created_idx" ON "credit_entries" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "passes_user_ends_idx" ON "passes" USING btree ("user_id","ends_at");--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_tier_check" CHECK ("quota_reservations"."tier" in ('standard', 'natural'));--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_units_check" CHECK ("quota_reservations"."free_units" >= 0 and "quota_reservations"."pass_units" >= 0 and "quota_reservations"."credit_units" >= 0);