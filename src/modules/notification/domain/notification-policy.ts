export const NOTIFICATION_POLICY = Symbol('NotificationPolicy');

/** Réglages d'exploitation des envois (ADR-0017), lus dans l'env par l'infrastructure. */
export interface NotificationPolicy {
  /** Plafond global de SMS par journée UTC (`SMS_DAILY_LIMIT`). */
  readonly smsDailyLimit: number;
}
