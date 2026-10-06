/** Codes d'erreur du module billing (statuts HTTP : table explicite de shared/http). */
export const BILLING_ERROR_CODES = {
  /** 402 : quota du mois épuisé (un abonnement ou des crédits le débloqueront). */
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  /** 422 : document au-delà du plafond par conversion (RNF-25). */
  QUOTA_CONVERSION_LIMIT_EXCEEDED: 'QUOTA_CONVERSION_LIMIT_EXCEEDED',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];
