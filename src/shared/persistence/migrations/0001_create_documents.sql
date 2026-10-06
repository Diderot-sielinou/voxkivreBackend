CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" varchar(32) NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_key" text NOT NULL,
	"rights_attested_at" timestamp with time zone NOT NULL,
	"rights_attestation_version" varchar(16) NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('awaiting_upload', 'uploaded')),
	CONSTRAINT "documents_size_positive_check" CHECK ("documents"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_owner_status_created_idx" ON "documents" USING btree ("owner_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_status_created_idx" ON "documents" USING btree ("status","created_at");