import { type OtpChannel } from '../otp-dispatch';

/** Codes par destination et par heure, SMS et e-mail (ADR-0017 §3). */
export const MAX_PER_DESTINATION_PER_HOUR = 3;

/** Part du plafond quotidien de SMS à partir de laquelle on alerte. */
export const DAILY_ALERT_RATIO = 0.8;

const HOUR_MS = 60 * 60 * 1000;

export function oneHourBefore(now: Date): Date {
  return new Date(now.getTime() - HOUR_MS);
}

/** Minuit UTC du jour de `now` : le plafond quotidien suit la journée UTC. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type DispatchRefusal = 'destination_hourly_limit' | 'sms_daily_limit';

/**
 * Peut-on envoyer ? `null` = oui. Le plafond quotidien ne concerne que le
 * SMS (chaque envoi coûte) ; le plafond par destination protège aussi une
 * boîte mail tierce d'un bombardement.
 */
export function refusalFor(input: {
  readonly channel: OtpChannel;
  readonly sentToDestinationLastHour: number;
  readonly smsSentToday: number;
  readonly smsDailyLimit: number;
}): DispatchRefusal | null {
  if (input.sentToDestinationLastHour >= MAX_PER_DESTINATION_PER_HOUR) {
    return 'destination_hourly_limit';
  }
  if (input.channel === 'sms' && input.smsSentToday >= input.smsDailyLimit) {
    return 'sms_daily_limit';
  }
  return null;
}

/** Vrai pile au franchissement du seuil d'alerte (une seule alerte par jour). */
export function crossesDailyAlert(smsSentIncludingThis: number, smsDailyLimit: number): boolean {
  return smsSentIncludingThis === Math.ceil(smsDailyLimit * DAILY_ALERT_RATIO);
}
