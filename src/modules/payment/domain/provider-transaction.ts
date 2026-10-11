/**
 * État d'une transaction **relu chez le prestataire** avec nos identifiants
 * (ADR-0021 §3) : la seule source qui fait foi, jamais le contenu d'une
 * notification.
 */
export interface ProviderTransaction {
  readonly reference: string;
  /** Notre `external_reference`, renvoyée par le prestataire ; `null` s'il n'en a pas. */
  readonly externalReference: string | null;
  readonly status: 'pending' | 'successful' | 'failed';
  /** Montant tel que reçu (Campay renvoie un décimal, ex. `2.0`). */
  readonly amount: number;
  readonly currency: string;
}
