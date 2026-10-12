import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Imports relatifs : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { conversions } from '../../../../conversion/infrastructure/persistence/schema/conversion.schema';
import { documents } from '../../../../document/infrastructure/persistence/schema/document.schema';
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// Constante locale (même raison) — longueur d'un nom d'erreur tracé.
const LAST_ERROR_MAX = 100;

/**
 * Position de lecture (RF-19/20, ADR-0015) : une ligne par conversion,
 * mise à jour en place selon « le plus récent gagne » (`recorded_at`).
 * Disparaît avec sa conversion ou le compte (`ON DELETE CASCADE`). La clé
 * primaire couvre les lectures (par conversion, filtrées par propriétaire).
 */
export const readingPositions = pgTable(
  'reading_positions',
  {
    conversionId: uuid('conversion_id')
      .primaryKey()
      .references(() => conversions.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wordIndex: integer('word_index').notNull(),
    audioMs: integer('audio_ms').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    check('reading_positions_word_index_check', sql`${t.wordIndex} >= 0`),
    check('reading_positions_audio_ms_check', sql`${t.audioMs} >= 0`),
  ],
);

/**
 * Outbox des fichiers à effacer (ADR-0016) : remplie dans la transaction qui
 * supprime les lignes, vidée par le balayage. Clé objet en clé primaire :
 * une même demande deux fois = une ligne. Index sur `requested_at` : les
 * plus anciennes d'abord.
 */
export const pendingFileDeletions = pgTable(
  'pending_file_deletions',
  {
    objectKey: text('object_key').primaryKey(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: LAST_ERROR_MAX }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('pending_file_deletions_requested_idx').on(t.requestedAt)],
);

/**
 * Marque-pages (RF-27, ADR-0028), ancrés au texte du document. Identifiant
 * créé par l'appareil ; `updated_at` = instant (appareil) de la dernière
 * modification ou suppression, « le plus récent gagne » par marque-page ;
 * `deleted_at` = trace de suppression (un appareil en retard ne le fait pas
 * réapparaître). Disparaissent avec le document ou le compte (cascade).
 * Index `(document_id, owner_id)` : liste et comptage d'un document.
 */
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    wordIndex: integer('word_index').notNull(),
    excerpt: text('excerpt').notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('bookmarks_document_owner_idx').on(t.documentId, t.ownerId),
    check('bookmarks_page_number_check', sql`${t.pageNumber} >= 1`),
    check('bookmarks_word_index_check', sql`${t.wordIndex} >= 0`),
  ],
);
