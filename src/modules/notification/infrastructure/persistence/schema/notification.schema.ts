import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Constantes locales : drizzle-kit bundle ce fichier sans les alias `@/`.
const CHANNEL_MAX = 8;
const DESTINATION_KEY_LENGTH = 64;

/**
 * Journal des codes envoyés (ADR-0017), pour les plafonds seulement :
 * empreinte HMAC de la destination (jamais en clair), purgé après 2 jours.
 * Index : comptage par destination sur 1 h, par canal sur la journée.
 */
export const otpDispatches = pgTable(
  'otp_dispatches',
  {
    id: uuid('id').primaryKey(),
    channel: varchar('channel', { length: CHANNEL_MAX }).notNull(),
    destinationKey: char('destination_key', { length: DESTINATION_KEY_LENGTH }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('otp_dispatches_destination_idx').on(t.destinationKey, t.sentAt),
    index('otp_dispatches_channel_idx').on(t.channel, t.sentAt),
    check('otp_dispatches_channel_check', sql`${t.channel} in ('email', 'sms')`),
  ],
);
