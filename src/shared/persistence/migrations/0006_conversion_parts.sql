CREATE TABLE "conversion_parts" (
	"conversion_id" uuid NOT NULL,
	"part_index" integer NOT NULL,
	"first_segment" integer NOT NULL,
	"last_segment" integer NOT NULL,
	"first_word_index" integer NOT NULL,
	"audio_key" text,
	"audio_bytes" integer,
	"audio_sha256" varchar(64),
	"vtt_key" text,
	"vtt_bytes" integer,
	"vtt_sha256" varchar(64),
	"duration_ms" integer,
	"word_count" integer,
	"page_starts" jsonb,
	"assembled_at" timestamp with time zone,
	CONSTRAINT "conversion_parts_conversion_id_part_index_pk" PRIMARY KEY("conversion_id","part_index"),
	CONSTRAINT "conversion_parts_range_check" CHECK ("conversion_parts"."first_segment" <= "conversion_parts"."last_segment")
);
--> statement-breakpoint
ALTER TABLE "conversions" DROP CONSTRAINT "conversions_status_check";--> statement-breakpoint
ALTER TABLE "conversion_segments" ADD COLUMN "part_index" integer;--> statement-breakpoint
ALTER TABLE "conversion_segments" ADD COLUMN "first_word_index" integer;--> statement-breakpoint
ALTER TABLE "conversions" ADD COLUMN "part_count" integer;--> statement-breakpoint
ALTER TABLE "conversion_parts" ADD CONSTRAINT "conversion_parts_conversion_id_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_status_check" CHECK ("conversions"."status" in ('queued', 'preparing', 'synthesizing', 'synthesized', 'ready', 'failed'));