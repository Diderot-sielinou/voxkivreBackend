import { type Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../value-objects/payment-status.vo';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Tentatives par utilisateur et par heure (ADR-0021 §10). */
export const MAX_ATTEMPTS_PER_USER_PER_HOUR = 5;
/** Tentatives par numéro et par 24 h glissantes : protège le titulaire d'un harcèlement. */
export const MAX_ATTEMPTS_PER_PHONE_PER_DAY = 3;
/** Un paiement `pending` plus récent bloque une nouvelle tentative du même utilisateur. */
export const IN_FLIGHT_WINDOW_MS = 15 * MINUTE_MS;
/** Le balayage laisse ce délai à la notification avant de demander lui-même (§9). */
export const SWEEP_GRACE_MS = 2 * MINUTE_MS;
/** Au-delà, un paiement sans réponse définitive passe en `expired`. */
export const PENDING_TTL_MS = 24 * HOUR_MS;
/** Sans référence du prestataire au-delà de ce délai, la demande n'a jamais abouti (§8). */
export const UNREFERENCED_TTL_MS = 15 * MINUTE_MS;

/** Bornes des fenêtres de comptage, calculées une fois par tentative. */
export interface AttemptWindows {
  readonly inFlightSince: Date;
  readonly userSince: Date;
  readonly phoneSince: Date;
}

export function attemptWindows(now: Date): AttemptWindows {
  return {
    inFlightSince: new Date(now.getTime() - IN_FLIGHT_WINDOW_MS),
    userSince: new Date(now.getTime() - HOUR_MS),
    phoneSince: new Date(now.getTime() - 24 * HOUR_MS),
  };
}

export type AttemptRefusal = 'user_hourly_limit' | 'phone_daily_limit';

/** Peut-on lancer une tentative de plus ? `null` = oui. */
export function attemptRefusalFor(counts: {
  readonly userAttemptsLastHour: number;
  readonly phoneAttemptsLastDay: number;
}): AttemptRefusal | null {
  if (counts.userAttemptsLastHour >= MAX_ATTEMPTS_PER_USER_PER_HOUR) return 'user_hourly_limit';
  if (counts.phoneAttemptsLastDay >= MAX_ATTEMPTS_PER_PHONE_PER_DAY) return 'phone_daily_limit';
  return null;
}

/** Paiements créés avant cette date : le balayage les relit. */
export function sweepCutoff(now: Date): Date {
  return new Date(now.getTime() - SWEEP_GRACE_MS);
}

/**
 * Le balayage doit-il abandonner ce paiement (`expired`) ? Sans référence
 * du prestataire, rien à relire : 15 min suffisent. Sinon 24 h.
 */
export function isExpiryDue(payment: Payment, now: Date): boolean {
  if (payment.status !== PaymentStatus.PENDING) return false;
  const age = now.getTime() - payment.createdAt.getTime();
  return payment.providerReference === null ? age >= UNREFERENCED_TTL_MS : age >= PENDING_TTL_MS;
}
