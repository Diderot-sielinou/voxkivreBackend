import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Import relatif : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// Constantes locales, même raison que l'import relatif.
const SHA256_HEX_LENGTH = 64;
const PHONE_SUFFIX_LENGTH = 2;

/**
 * Paiements Mobile Money (ADR-0021) : une ligne par demande d'encaissement.
 *
 * - prix **recopié** de l'offre à la création (jamais fourni par le client) ;
 *   pas de clé étrangère vers `offers` : la table appartient à `billing`,
 *   l'offre est vérifiée par son port ;
 * - numéro jamais en clair : empreinte HMAC (plafond par numéro) et deux
 *   derniers chiffres (affichage) ;
 * - `external_reference` (UUID v4) : notre référence chez Campay, qui rend
 *   la demande d'encaissement idempotente ; `provider_reference` : la sienne,
 *   absente tant que Campay n'a pas répondu (ADR-0021 §8) ;
 * - `completed_at` posé dès que le paiement quitte `pending`.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    offerCode: varchar('offer_code', { length: 32 }).notNull(),
    amountXaf: integer('amount_xaf').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestHash: char('request_hash', { length: SHA256_HEX_LENGTH }).notNull(),
    provider: varchar('provider', { length: 16 }).notNull(),
    externalReference: uuid('external_reference').notNull(),
    providerReference: varchar('provider_reference', { length: 64 }),
    phoneHmac: char('phone_hmac', { length: SHA256_HEX_LENGTH }).notNull(),
    phoneSuffix: char('phone_suffix', { length: PHONE_SUFFIX_LENGTH }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    confirmedVia: varchar('confirmed_via', { length: 8 }),
    failureCode: varchar('failure_code', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    unique('payments_user_id_idempotency_key_key').on(t.userId, t.idempotencyKey),
    unique('payments_external_reference_key').on(t.externalReference),
    unique('payments_provider_reference_key').on(t.provider, t.providerReference),
    // Balayage de réconciliation (§9) : seuls les paiements en attente.
    index('payments_pending_created_at_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    // Plafonds (§10) : tentatives par utilisateur et par numéro.
    index('payments_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('payments_phone_hmac_created_at_idx').on(t.phoneHmac, t.createdAt),
    check('payments_amount_check', sql`${t.amountXaf} > 0`),
    check('payments_provider_check', sql`${t.provider} in ('fake', 'campay')`),
    check(
      'payments_status_check',
      sql`${t.status} in ('pending', 'succeeded', 'failed', 'expired', 'amount_mismatch')`,
    ),
    check(
      'payments_confirmed_via_check',
      sql`${t.confirmedVia} is null or ${t.confirmedVia} in ('webhook', 'sweep')`,
    ),
    check('payments_completed_check', sql`(${t.status} = 'pending') = (${t.completedAt} is null)`),
  ],
);
