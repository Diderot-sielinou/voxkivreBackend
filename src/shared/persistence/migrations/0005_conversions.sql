CREATE TABLE "conversion_segments" (
	"conversion_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"ssml" text NOT NULL,
	"words" jsonb NOT NULL,
	"char_count" integer NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"audio_key" text,
	"timepoints" jsonb,
	"duration_ms" integer,
	"cache_hit" boolean,
	"synthesized_at" timestamp with time zone,
	CONSTRAINT "conversion_segments_conversion_id_segment_index_pk" PRIMARY KEY("conversion_id","segment_index"),
	CONSTRAINT "conversion_segments_index_check" CHECK ("conversion_segments"."segment_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"voice_id" varchar(32) NOT NULL,
	"text_revision" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"reserved_chars" integer NOT NULL,
	"segment_count" integer,
	"failure_reason" varchar(32),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "conversions_status_check" CHECK ("conversions"."status" in ('queued', 'preparing', 'synthesizing', 'synthesized', 'failed')),
	CONSTRAINT "conversions_reserved_chars_check" CHECK ("conversions"."reserved_chars" > 0)
);
--> statement-breakpoint
ALTER TABLE "conversion_segments" ADD CONSTRAINT "conversion_segments_conversion_id_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversions_active_target_idx" ON "conversions" USING btree ("document_id","voice_id","text_revision") WHERE "conversions"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "conversions_status_updated_idx" ON "conversions" USING btree ("status","updated_at");