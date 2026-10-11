import { DomainError } from '@/shared/kernel';

import { BILLING_ERROR_CODES } from './error-codes';

/**
 * Une référence de paiement déjà accordée revient pour un autre utilisateur
 * ou une autre offre : jamais accordée deux fois (RNF-09), et l'incohérence
 * est signalée plutôt qu'avalée.
 */
export class PaymentReferenceConflictError extends DomainError {
  readonly code = BILLING_ERROR_CODES.PAYMENT_REFERENCE_CONFLICT;

  constructor(paymentReference: string) {
    super('Payment reference already granted for another purchase', {
      details: { paymentReference },
    });
  }
}
