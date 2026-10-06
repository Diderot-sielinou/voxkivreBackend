ALTER TABLE "documents" ADD COLUMN "text_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Textes déjà extraits avant cette migration : révision 1, comme une extraction neuve.
UPDATE "documents" SET "text_revision" = 1 WHERE "status" = 'text_ready';
