/**
 * Token DI de l'instance better-auth. Fichier isolé (sans import de
 * module) pour que `SessionGuard` et le bootstrap puissent l'importer sans
 * cycle.
 */
export const BETTER_AUTH = Symbol('BetterAuth');

/** Préfixe de montage du handler better-auth (cf. bootstrap/auth.bootstrap.ts). */
export const AUTH_BASE_PATH = '/api/auth';
