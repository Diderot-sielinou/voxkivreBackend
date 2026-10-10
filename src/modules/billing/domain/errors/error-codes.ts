/** Codes d'erreur du module billing (statuts HTTP : table explicite de shared/http). */
export const BILLING_ERROR_CODES = {
  /** 402 : les sources disponibles ne couvrent pas la conversion (un pass ou des crédits la débloqueront). */
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  /** 422 : document au-delà du plafond par conversion (RNF-25). */
  QUOTA_CONVERSION_LIMIT_EXCEEDED: 'QUOTA_CONVERSION_LIMIT_EXCEEDED',
  /** 404 : offre inconnue du catalogue. */
  OFFER_NOT_FOUND: 'OFFER_NOT_FOUND',
  /** 409 : référence de paiement déjà accordée pour un autre utilisateur ou une autre offre. */
  PAYMENT_REFERENCE_CONFLICT: 'PAYMENT_REFERENCE_CONFLICT',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];
