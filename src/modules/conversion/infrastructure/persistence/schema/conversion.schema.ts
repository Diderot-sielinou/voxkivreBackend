import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Imports relatifs : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { documents } from '../../../../document/infrastructure/persistence/schema/document.schema';
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// Constantes locales (même raison) — alignées sur le domaine.
const VOICE_ID_MAX = 32;
const STATUS_MAX = 32;
const FAILURE_REASON_MAX = 32;
const FINGERPRINT_LENGTH = 64;
const SHA256_LENGTH = 64;

/**
 * Conversions (SDD §7.1) : une révision du texte d'un document, une voix.
 *
 * - Index unique partiel `(document_id, voice_id, text_revision) WHERE status
 *   <> 'failed'` : une seule conversion active par cible — le double
 *   lancement ne peut pas débiter deux fois (ADR-0010).
 * - Index `(status, updated_at)` : balayage des conversions bloquées.
 * - `owner_id` et `document_id` en `ON DELETE CASCADE` : supprimer le compte
 *   ou le document supprime ses conversions.
 */
export const conversions = pgTable(
  'conversions',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    voiceId: varchar('voice_id', { length: VOICE_ID_MAX }).notNull(),
    textRevision: integer('text_revision').notNull(),
    status: varchar('status', { length: STATUS_MAX }).notNull(),
    reservedChars: integer('reserved_chars').notNull(),
    segmentCount: integer('segment_count'),
    partCount: integer('part_count'),
    failureReason: varchar('failure_reason', { length: FAILURE_REASON_MAX }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('conversions_active_target_idx')
      .on(t.documentId, t.voiceId, t.textRevision)
      .where(sql`${t.status} <> 'failed'`),
    index('conversions_status_updated_idx').on(t.status, t.updatedAt),
    check(
      'conversions_status_check',
      sql`${t.status} in ('queued', 'preparing', 'synthesizing', 'synthesized', 'ready', 'failed')`,
    ),
    check('conversions_reserved_chars_check', sql`${t.reservedChars} > 0`),
  ],
);

/**
 * Segments SSML d'une conversion, copiés à la préparation : le texte est
 * figé, une correction ultérieure ne perturbe pas la synthèse en cours.
 * `audio_key` non nul = segment synthétisé (une seule fois, RNF-12).
 */
export const conversionSegments = pgTable(
  'conversion_segments',
  {
    conversionId: uuid('conversion_id')
      .notNull()
      .references(() => conversions.id, { onDelete: 'cascade' }),
    segmentIndex: integer('segment_index').notNull(),
    ssml: text('ssml').notNull(),
    // `[{ t: mot, p: page }]` : relu par l'assemblage WebVTT (2c).
    words: jsonb('words').notNull(),
    charCount: integer('char_count').notNull(),
    fingerprint: varchar('fingerprint', { length: FINGERPRINT_LENGTH }).notNull(),
    // Plan des parties (ADR-0011) ; `null` pour les conversions préparées avant la 2c.
    partIndex: integer('part_index'),
    firstWordIndex: integer('first_word_index'),
    audioKey: text('audio_key'),
    // Début de chaque mot en secondes (`null` si la marque manque), aligné sur `words`.
    timepoints: jsonb('timepoints'),
    durationMs: integer('duration_ms'),
    cacheHit: boolean('cache_hit'),
    synthesizedAt: timestamp('synthesized_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.conversionId, t.segmentIndex] }),
    check('conversion_segments_index_check', sql`${t.segmentIndex} >= 0`),
  ],
);

/**
 * Parties livrées au mobile (ADR-0011) : plan fixé à la préparation,
 * fichiers renseignés à l'assemblage (`assembled_at` non nul = assemblée,
 * une seule fois).
 */
export const conversionParts = pgTable(
  'conversion_parts',
  {
    conversionId: uuid('conversion_id')
      .notNull()
      .references(() => conversions.id, { onDelete: 'cascade' }),
    partIndex: integer('part_index').notNull(),
    firstSegment: integer('first_segment').notNull(),
    lastSegment: integer('last_segment').notNull(),
    firstWordIndex: integer('first_word_index').notNull(),
    audioKey: text('audio_key'),
    audioBytes: integer('audio_bytes'),
    audioSha256: varchar('audio_sha256', { length: SHA256_LENGTH }),
    vttKey: text('vtt_key'),
    vttBytes: integer('vtt_bytes'),
    vttSha256: varchar('vtt_sha256', { length: SHA256_LENGTH }),
    durationMs: integer('duration_ms'),
    wordCount: integer('word_count'),
    // `[{ page, wordIndex }]` : pages qui commencent dans la partie.
    pageStarts: jsonb('page_starts'),
    assembledAt: timestamp('assembled_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.conversionId, t.partIndex] }),
    check('conversion_parts_range_check', sql`${t.firstSegment} <= ${t.lastSegment}`),
  ],
);
