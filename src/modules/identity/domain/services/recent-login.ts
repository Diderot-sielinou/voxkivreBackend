/** Âge maximal d'une session pour supprimer le compte (ADR-0023 §2). */
export const RECENT_LOGIN_MAX_AGE_MS = 10 * 60 * 1000;

/** La session a été ouverte (code OTP saisi) il y a au plus 10 minutes. */
export function isRecentLogin(sessionCreatedAt: Date, now: Date): boolean {
  return now.getTime() - sessionCreatedAt.getTime() <= RECENT_LOGIN_MAX_AGE_MS;
}
