import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
 * Compteur de quota par utilisateur et par mois (ADR-0010). Une ligne par
 * `(user_id, period)` : la réservation est un seul `INSERT … ON CONFLICT DO
 * UPDATE … WHERE` conditionnel, donc sans course entre deux lancements.
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
 * Rend la réservation et le remboursement idempotents, et garde la trace.
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
  ],
);
