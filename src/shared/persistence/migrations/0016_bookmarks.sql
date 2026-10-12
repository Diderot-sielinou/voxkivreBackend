CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"word_index" integer NOT NULL,
	"excerpt" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bookmarks_page_number_check" CHECK ("bookmarks"."page_number" >= 1),
	CONSTRAINT "bookmarks_word_index_check" CHECK ("bookmarks"."word_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_document_owner_idx" ON "bookmarks" USING btree ("document_id","owner_id");