CREATE TABLE "document_pages" (
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"char_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_pages_document_id_page_number_pk" PRIMARY KEY("document_id","page_number"),
	CONSTRAINT "document_pages_page_number_check" CHECK ("document_pages"."page_number" >= 1),
	CONSTRAINT "document_pages_char_count_check" CHECK ("document_pages"."char_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_status_check";--> statement-breakpoint
DROP INDEX "documents_owner_status_created_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "char_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_error" varchar(32);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_owner_library_idx" ON "documents" USING btree ("owner_id","created_at","id") WHERE "documents"."status" <> 'awaiting_upload';--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('awaiting_upload', 'uploaded', 'extracting', 'text_ready', 'extraction_failed'));