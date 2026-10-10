CREATE TABLE "pending_file_deletions" (
	"object_key" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(100),
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reading_positions" (
	"conversion_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"word_index" integer NOT NULL,
	"audio_ms" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reading_positions_word_index_check" CHECK ("reading_positions"."word_index" >= 0),
	CONSTRAINT "reading_positions_audio_ms_check" CHECK ("reading_positions"."audio_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_conversion_id_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_file_deletions_requested_idx" ON "pending_file_deletions" USING btree ("requested_at");