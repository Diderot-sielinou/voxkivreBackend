import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// Constantes locales — drizzle-kit bundle ce fichier via esbuild et ne
// résout pas les alias `@/`.
const NAME_MAX = 200;
const EMAIL_MAX = 255;
const PHONE_MAX = 20;
const ROLE_MAX = 16;

/**
 * Tables **possédées par better-auth** : `user`, `session`, `account`,
 * `verification`, `rate_limit`. Noms de modèles imposés par la lib ; les
 * colonnes snake_case sont mappées par le drizzleAdapter.
 *
 * Nos extensions (déclarées AUSSI dans `additionalFields` côté better-auth) :
 * - `user.role` : 'user' | 'admin' (jamais modifiable par le client).
 * Le plugin `phoneNumber` ajoute `phone_number` / `phone_number_verified`.
 *
 * PKs en `text` : better-auth émet ses propres ids (string opaque).
 * FKs `ON DELETE CASCADE` : supprimer un user nettoie sessions/comptes.
 */
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: varchar('name', { length: NAME_MAX }).notNull(),
    email: varchar('email', { length: EMAIL_MAX }).notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // Plugin phoneNumber (E.164). Unique : un numéro = un compte.
    phoneNumber: varchar('phone_number', { length: PHONE_MAX }).unique(),
    phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
    role: varchar('role', { length: ROLE_MAX }).notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('user_role_created_at_idx').on(table.role, table.createdAt)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Comptes liés à un fournisseur d'identité. Sans OAuth au MVP, la table
 * reste quasi vide (better-auth y crée une ligne `credential` par user
 * OTP) — conservée : requise par la lib, et prête pour un futur SSO (Niv. 4).
 */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('account_provider_account_idx').on(table.providerId, table.accountId),
    index('account_user_id_idx').on(table.userId),
  ],
);

/** OTP (hashés) et jetons de vérification, avec expiration. */
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Compteurs du rate-limit better-auth (`rateLimit.storage: 'database'`).
 * Les routes `/api/auth/*` sont montées en middleware Express, HORS du
 * ThrottlerGuard Nest : c'est la seule protection des routes d'envoi d'OTP.
 * Postgres plutôt que Redis : pas de dépendance au client Redis sur le
 * chemin d'auth (cf. ADR-0002), volume faible.
 */
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
