/** Codes d'erreur du module payment (convention de routing : cf. shared/http). */
export const PAYMENT_ERROR_CODES = {
  /** 404 : paiement inconnu, ou appartenant à un autre utilisateur (RNF-08). */
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** Même code que billing : le mobile n'a qu'un message par cas. */
  OFFER_NOT_FOUND: 'OFFER_NOT_FOUND',
  /** 422 : numéro hors mobiles camerounais, ou refusé par le prestataire (ER101, ER102). */
  INVALID_PAYMENT_PHONE: 'INVALID_PAYMENT_PHONE',
  /** 409 : un paiement récent attend encore la confirmation sur le téléphone. */
  PAYMENT_IN_PROGRESS_CONFLICT: 'PAYMENT_IN_PROGRESS_CONFLICT',
  /** 409 : même `Idempotency-Key`, requête différente. */
  PAYMENT_IDEMPOTENCY_CONFLICT: 'PAYMENT_IDEMPOTENCY_CONFLICT',
  /** 429 : trop de tentatives pour ce compte ou ce numéro (ADR-0021 §10). */
  RATE_LIMIT_PAYMENT_ATTEMPTS: 'RATE_LIMIT_PAYMENT_ATTEMPTS',
  /** 401 : notification dont la signature ne se vérifie pas. */
  UNAUTHORIZED_PAYMENT_NOTIFICATION: 'UNAUTHORIZED_PAYMENT_NOTIFICATION',
  /** 503 : prestataire injoignable ou réponse inexploitable (RNF-11). */
  PAYMENT_UNAVAILABLE: 'INFRASTRUCTURE_PAYMENT_UNAVAILABLE',
} as const;

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[keyof typeof PAYMENT_ERROR_CODES];
