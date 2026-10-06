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

// Import relatif : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// Constantes locales (même raison) — alignées sur le domaine.
const TITLE_MAX = 200;
const STATUS_MAX = 32;
const ATTESTATION_VERSION_MAX = 16;

/**
 * Documents importés (RF-01). Métadonnées uniquement : les octets vivent
 * dans le stockage objet sous `source_key` (ADR-0007).
 *
 * - `owner_id` → `user.id` `ON DELETE CASCADE` : supprimer un compte supprime
 *   ses documents (les fichiers sont à purger par le même flux).
 * - Index `(owner_id, status, created_at, id)` : couvre la bibliothèque
 *   paginée par cursor (filtre propriétaire + statut, tri stable).
 * - Index `(status, created_at)` : couvre la purge des uploads abandonnés.
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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('documents_owner_status_created_idx').on(t.ownerId, t.status, t.createdAt, t.id),
    index('documents_status_created_idx').on(t.status, t.createdAt),
    check('documents_status_check', sql`${t.status} in ('awaiting_upload', 'uploaded')`),
    check('documents_size_positive_check', sql`${t.sizeBytes} > 0`),
  ],
);
