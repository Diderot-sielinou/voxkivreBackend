/**
 * Règles de rate-limit better-auth (clé = IP), par route. Complète le
 * `allowedAttempts` des plugins (compteur par identifiant côté OTP).
 *
 * Envoi d'OTP : coûte un SMS/email et alimente l'abus du palier gratuit
 * (RNF-28) → strict. Vérification : brute-force déjà borné par
 * `allowedAttempts`, on limite seulement le volume.
 */
const TEN_MINUTES = 60 * 10;

export const AUTH_RATE_LIMIT_DEFAULT = { window: 60, max: 60 } as const;

export const AUTH_RATE_LIMIT_RULES = {
  '/email-otp/send-verification-otp': { window: TEN_MINUTES, max: 5 },
  '/phone-number/send-otp': { window: TEN_MINUTES, max: 5 },
  '/sign-in/email-otp': { window: TEN_MINUTES, max: 15 },
  '/phone-number/verify': { window: TEN_MINUTES, max: 15 },
} as const;
