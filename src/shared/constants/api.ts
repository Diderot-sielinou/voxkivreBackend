/**
 * Conventions API partagées par `main.ts`, le bootstrap et les contrôleurs.
 *
 * Pourquoi ici plutôt que dans `Env` : ce ne sont pas des choix de
 * déploiement (qui varient par environnement) mais des conventions de code
 * fixées par les ADRs et le produit. La règle "aucun hardcode" vaut aussi
 * pour les littéraux disséminés dans le code, pas seulement les secrets.
 */
export const API_NAME = 'voxlivre-api';
export const API_TITLE = 'Voxlivre backend API';

/** Version par défaut de l'URI versioning (`/v1/...`, cf. ADR-0002). */
export const API_DEFAULT_VERSION = '1';

export const SWAGGER_PATH = 'docs';
export const SWAGGER_JSON_PATH = `${SWAGGER_PATH}/openapi.json`;

/**
 * Origines dev autorisées en fallback hors `production` quand
 * `CORS_ALLOWED_ORIGINS` est vide. Voxlivre est mobile-only : le seul client
 * navigateur attendu est Swagger UI servi par l'API elle-même, mais un front
 * d'admin local (port 3000) reste plausible.
 */
export const DEV_CORS_FALLBACK_ORIGINS: readonly string[] = ['http://localhost:3000'];

/** `Strict-Transport-Security` max-age : 1 an (OWASP + preload-list). */
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/**
 * Nom du bucket throttler par défaut. Les endpoints sensibles (demande
 * d'OTP, webhooks paiement) déclareront leur propre bucket via `@Throttle()`.
 */
export const RATE_LIMITER_NAME_DEFAULT = 'default';
