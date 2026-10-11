import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Import relatif : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// Constantes locales (même raison) — alignées sur le domaine.
const TITLE_MAX = 200;
const STATUS_MAX = 32;
const ATTESTATION_VERSION_MAX = 16;
const EXTRACTION_ERROR_MAX = 32;

/**
 * Documents importés (RF-01). Métadonnées uniquement : les octets vivent
 * dans le stockage objet sous `source_key` (ADR-0007).
 *
 * - `owner_id` → `user.id` `ON DELETE CASCADE` : supprimer un compte supprime
 *   ses documents (les fichiers sont à purger par le même flux).
 * - Index partiel `(owner_id, created_at, id) WHERE status <> 'awaiting_upload'` :
 *   bibliothèque paginée par cursor (tri stable).
 * - Index `(status, created_at)` : purge et rattrapage par statut.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: TITLE_MAX }).notNull(),
    status: varchar('status', { length: STATUS_MAX }).notNull(),
    // integer : 2 Go max, très au-delà du plafond (50 Mo par défaut).
    sizeBytes: integer('size_bytes').notNull(),
    sourceKey: text('source_key').notNull().unique(),
    rightsAttestedAt: timestamp('rights_attested_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    rightsAttestationVersion: varchar('rights_attestation_version', {
      length: ATTESTATION_VERSION_MAX,
    }).notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }),
    pageCount: integer('page_count'),
    charCount: integer('char_count'),
    textRevision: integer('text_revision').notNull().default(0),
    extractionError: varchar('extraction_error', { length: EXTRACTION_ERROR_MAX }),
    sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    // Bibliothèque : tous les statuts sauf les imports jamais confirmés.
    index('documents_owner_library_idx')
      .on(t.ownerId, t.createdAt, t.id)
      .where(sql`${t.status} <> 'awaiting_upload'`),
    // Purge des uploads abandonnés et rattrapage des extractions non programmées.
    index('documents_status_created_idx').on(t.status, t.createdAt),
    check(
      'documents_status_check',
      sql`${t.status} in ('awaiting_upload', 'uploaded', 'extracting', 'text_ready', 'extraction_failed')`,
    ),
    check('documents_size_positive_check', sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * Texte du livre, page par page (RF-06). Seule source après suppression du
 * PDF (CdC §8). Clé `(document_id, page_number)` : lecture ordonnée par la
 * PK, réécriture idempotente d'une page.
 */
export const documentPages = pgTable(
  'document_pages',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull(),
    // Lignes retirées par le nettoyage (ADR-0022), avec leur motif : le PDF
    // étant supprimé, c'est la seule trace pour les réintégrer (RF-06).
    // `null` pour les pages extraites avant le nettoyage. Jamais requêté.
    setAside: jsonb('set_aside').$type<readonly { text: string; reason: string }[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.pageNumber] }),
    check('document_pages_page_number_check', sql`${t.pageNumber} >= 1`),
    check('document_pages_char_count_check', sql`${t.charCount} >= 0`),
  ],
);
