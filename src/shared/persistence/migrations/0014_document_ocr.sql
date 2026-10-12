CREATE TABLE "document_ocr_pages" (
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"confidence" real,
	"recognized_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_ocr_pages_document_id_page_number_pk" PRIMARY KEY("document_id","page_number"),
	CONSTRAINT "document_ocr_pages_page_number_check" CHECK ("document_ocr_pages"."page_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "ocr_confidence" real;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_method" varchar(16);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ocr_page_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_ocr_pages" ADD CONSTRAINT "document_ocr_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_owner_ocr_idx" ON "documents" USING btree ("owner_id","uploaded_at") WHERE "documents"."extraction_method" = 'ocr';--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_ocr_confidence_check" CHECK ("document_pages"."ocr_confidence" is null or ("document_pages"."ocr_confidence" >= 0 and "document_pages"."ocr_confidence" <= 1));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_extraction_method_check" CHECK ("documents"."extraction_method" is null or "documents"."extraction_method" in ('native', 'ocr'));