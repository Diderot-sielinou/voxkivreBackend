import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Import relatif : drizzle-kit bundle ce fichier via esbuild sans les alias `@/`.
import { user } from '../../../../identity/infrastructure/persistence/schema/auth.schema';

// `YYYY-MM` (constante locale, même raison que l'import relatif).
const PERIOD_LENGTH = 7;

/**
 * Palier gratuit : unités prises par utilisateur et par mois (ADR-0010,
 * ADR-0019). La colonne garde son nom d'origine `reserved_chars` (pas de
 * renommage en un déploiement, migrations.md) ; elle compte des **unités**
 * du palier gratuit, qui ne finance que des voix standard (1 unité = 1
 * caractère).
 */
export const quotaUsage = pgTable(
  'quota_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: PERIOD_LENGTH }).notNull(),
    // bigint : compteurs de quota (migrations.md) ; `number` suffit (< 2^53).
    reservedChars: bigint('reserved_chars', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.period] }),
    check('quota_usage_reserved_chars_check', sql`${t.reservedChars} >= 0`),
  ],
);

/**
 * Une ligne par opération débitée (`reservation_id` = identifiant de la
 * conversion, sans clé étrangère : `billing` ne dépend pas de `conversion`).
 * Rend la réservation et le remboursement idempotents, garde la trace, et
 * dit quelle part chaque source a donnée (ADR-0019) — le remboursement rend
 * à chacune la sienne.
 */
export const quotaReservations = pgTable(
  'quota_reservations',
  {
    reservationId: uuid('reservation_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: PERIOD_LENGTH }).notNull(),
    chars: bigint('chars', { mode: 'number' }).notNull(),
    tier: varchar('tier', { length: 8 }).notNull().default('standard'),
    // Pass débité (sans clé étrangère : un pass n'est jamais supprimé seul).
    passId: uuid('pass_id'),
    freeUnits: bigint('free_units', { mode: 'number' }).notNull().default(0),
    passUnits: bigint('pass_units', { mode: 'number' }).notNull().default(0),
    creditUnits: bigint('credit_units', { mode: 'number' }).notNull().default(0),
    refundedChars: bigint('refunded_chars', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    check('quota_reservations_chars_check', sql`${t.chars} > 0`),
    check(
      'quota_reservations_refund_check',
      sql`${t.refundedChars} is null or (${t.refundedChars} >= 0 and ${t.refundedChars} <= ${t.chars})`,
    ),
    check('quota_reservations_tier_check', sql`${t.tier} in ('standard', 'natural')`),
    check(
      'quota_reservations_units_check',
      sql`${t.freeUnits} >= 0 and ${t.passUnits} >= 0 and ${t.creditUnits} >= 0`,
    ),
  ],
);

/**
 * Catalogue (ADR-0019 §7), rempli **par migration** : un prix change par une
 * migration revue, jamais par une variable d'env. Une offre retirée
 * (`active = false`) reste référencée par les achats passés.
 */
export const offers = pgTable(
  'offers',
  {
    code: varchar('code', { length: 32 }).primaryKey(),
    kind: varchar('kind', { length: 8 }).notNull(),
    // FCFA entiers (pas de sous-unité en usage).
    priceXaf: integer('price_xaf').notNull(),
    units: bigint('units', { mode: 'number' }).notNull(),
    durationDays: integer('duration_days'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('offers_kind_check', sql`${t.kind} in ('pass', 'credits')`),
    check('offers_price_check', sql`${t.priceXaf} >= 0`),
    check('offers_units_check', sql`${t.units} > 0`),
    // Un pass a une durée, des crédits n'en ont pas.
    check(
      'offers_duration_check',
      sql`(${t.kind} = 'pass') = (${t.durationDays} is not null and ${t.durationDays} > 0)`,
    ),
  ],
);

/**
 * Un achat accordé par paiement confirmé (ADR-0019 §9). La clé primaire est
 * la référence de paiement : un même paiement n'accorde jamais deux fois
 * (RNF-09). Prix et unités **recopiés** de l'offre.
 */
export const purchases = pgTable('purchases', {
  paymentReference: varchar('payment_reference', { length: 128 }).primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  offerCode: varchar('offer_code', { length: 32 })
    .notNull()
    .references(() => offers.code),
  kind: varchar('kind', { length: 8 }).notNull(),
  priceXaf: integer('price_xaf').notNull(),
  units: bigint('units', { mode: 'number' }).notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** Périodes de pass (ADR-0019 §3) : une par achat, `[starts_at, ends_at)`. */
export const passes = pgTable(
  'passes',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    paymentReference: varchar('payment_reference', { length: 128 })
      .notNull()
      .unique('passes_payment_reference_key')
      .references(() => purchases.paymentReference, { onDelete: 'cascade' }),
    offerCode: varchar('offer_code', { length: 32 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    includedUnits: bigint('included_units', { mode: 'number' }).notNull(),
    usedUnits: bigint('used_units', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    index('passes_user_ends_idx').on(t.userId, t.endsAt),
    check('passes_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('passes_units_check', sql`${t.usedUnits} >= 0 and ${t.usedUnits} <= ${t.includedUnits}`),
  ],
);

/** Solde de crédits (ADR-0019) : jamais négatif, contrainte en base. */
export const wallets = pgTable(
  'wallets',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    balanceUnits: bigint('balance_units', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [check('wallets_balance_check', sql`${t.balanceUnits} >= 0`)],
);

/**
 * Journal du portefeuille (ADR-0019 §10), en **ajout seul** : achat (+),
 * consommation (−), remboursement (+), écrit dans la même transaction que
 * le solde.
 */
export const creditEntries = pgTable(
  'credit_entries',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 12 }).notNull(),
    units: bigint('units', { mode: 'number' }).notNull(),
    offerCode: varchar('offer_code', { length: 32 }),
    reservationId: uuid('reservation_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('credit_entries_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    check('credit_entries_kind_check', sql`${t.kind} in ('purchase', 'consumption', 'refund')`),
    check('credit_entries_units_check', sql`${t.units} <> 0`),
  ],
);
