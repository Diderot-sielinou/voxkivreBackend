/**
 * Cycle de vie d'un paiement (ADR-0021 §5) :
 *
 * ```
 * pending → succeeded | failed | expired | amount_mismatch
 * expired → succeeded   (seule exception : confirmé après abandon)
 * ```
 *
 * Toute transition est conditionnelle en base (`WHERE status = …`) : une
 * notification et le balayage peuvent arriver en même temps.
 */
export const PaymentStatus = {
  /** Demande envoyée (ou en cours d'envoi) au téléphone ; on attend le client. */
  PENDING: 'pending',
  /** Confirmé chez le prestataire, offre accordée dans la même transaction. */
  SUCCEEDED: 'succeeded',
  /** Refusé, annulé ou expiré côté opérateur ; rien n'a été débité. */
  FAILED: 'failed',
  /** Sans réponse définitive dans le délai : le balayage cesse de demander. */
  EXPIRED: 'expired',
  /** Montant ou devise reçus ≠ prix recopié : rien d'accordé, examen à la main. */
  AMOUNT_MISMATCH: 'amount_mismatch',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Chemin par lequel un paiement a été conclu : base du taux de réconciliation (RNF-27). */
export const ConfirmationChannel = {
  WEBHOOK: 'webhook',
  SWEEP: 'sweep',
} as const;

export type ConfirmationChannel = (typeof ConfirmationChannel)[keyof typeof ConfirmationChannel];

/** Prestataires connus ; `fake` pour le développement et les e2e (ADR-0021 §15). */
export const PaymentProvider = {
  FAKE: 'fake',
  CAMPAY: 'campay',
} as const;

export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

/**
 * Raison stable d'un échec (le mobile branche son message dessus) :
 * - `invalid_phone`   : numéro refusé par le prestataire (opérateur non pris en charge) ;
 * - `declined`        : refusé, annulé ou sans réponse sur le téléphone ;
 * - `no_provider_reference` : le prestataire n'a jamais confirmé la demande (§8).
 */
export const PaymentFailureCode = {
  INVALID_PHONE: 'invalid_phone',
  DECLINED: 'declined',
  NO_PROVIDER_REFERENCE: 'no_provider_reference',
} as const;

export type PaymentFailureCode = (typeof PaymentFailureCode)[keyof typeof PaymentFailureCode];
