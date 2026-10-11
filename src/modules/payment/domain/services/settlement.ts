import { type Payment } from '../entities/payment.entity';
import { type ProviderTransaction } from '../provider-transaction';
import { PaymentFailureCode, PaymentStatus } from '../value-objects/payment-status.vo';

/** Seule devise acceptée (ADR-0019 §8). */
export const PAYMENT_CURRENCY = 'XAF';

/**
 * Que faire d'un paiement au vu de l'état relu chez le prestataire
 * (ADR-0021 §4–5) ? Même décision pour une notification et pour le
 * balayage.
 *
 * - `succeed` : accorder l'offre et passer en `succeeded` (depuis `pending`
 *   ou `expired`) ;
 * - `fail` / `flag_amount_mismatch` : conclure sans rien accorder ;
 * - `wait` : toujours en attente chez le prestataire ;
 * - `none` : déjà conclu dans le même sens (notification rejouée) ;
 * - `anomaly` : incohérence à examiner à la main, rien n'est modifié.
 */
export type Settlement =
  | { readonly kind: 'succeed'; readonly from: PaymentStatus }
  | { readonly kind: 'fail'; readonly failureCode: PaymentFailureCode }
  | { readonly kind: 'flag_amount_mismatch' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'none' }
  | { readonly kind: 'anomaly'; readonly reason: SettlementAnomaly };

export type SettlementAnomaly =
  /** La transaction relue ne porte pas notre référence : elle n'est pas à ce paiement. */
  | 'reference_mismatch'
  /** Réussite annoncée pour un paiement déjà conclu en échec. */
  | 'successful_after_failure'
  /** Échec annoncé pour un paiement déjà accordé. */
  | 'failed_after_success';

export function settlementFor(payment: Payment, transaction: ProviderTransaction): Settlement {
  // UUID : la casse ne compte pas.
  if (transaction.externalReference?.toLowerCase() !== payment.externalReference.toLowerCase()) {
    return { kind: 'anomaly', reason: 'reference_mismatch' };
  }
  switch (transaction.status) {
    case 'pending': {
      return payment.status === PaymentStatus.PENDING ? { kind: 'wait' } : { kind: 'none' };
    }
    case 'successful': {
      return settleSuccessful(payment, transaction);
    }
    case 'failed': {
      return settleFailed(payment);
    }
  }
}

function settleSuccessful(payment: Payment, transaction: ProviderTransaction): Settlement {
  switch (payment.status) {
    case PaymentStatus.PENDING:
    case PaymentStatus.EXPIRED: {
      return isAmountMatching(payment.amountXaf, transaction)
        ? { kind: 'succeed', from: payment.status }
        : { kind: 'flag_amount_mismatch' };
    }
    case PaymentStatus.FAILED: {
      return { kind: 'anomaly', reason: 'successful_after_failure' };
    }
    case PaymentStatus.SUCCEEDED:
    case PaymentStatus.AMOUNT_MISMATCH: {
      return { kind: 'none' };
    }
  }
}

function settleFailed(payment: Payment): Settlement {
  switch (payment.status) {
    case PaymentStatus.PENDING: {
      return { kind: 'fail', failureCode: PaymentFailureCode.DECLINED };
    }
    case PaymentStatus.SUCCEEDED: {
      return { kind: 'anomaly', reason: 'failed_after_success' };
    }
    // `expired → failed` n'est pas une transition (§5) : l'issue est la même.
    case PaymentStatus.EXPIRED:
    case PaymentStatus.FAILED:
    case PaymentStatus.AMOUNT_MISMATCH: {
      return { kind: 'none' };
    }
  }
}

/**
 * Montant reçu **égal** au prix recopié, en XAF. Le décimal du prestataire
 * (`2.0`) n'est accepté que s'il est entier : `2.5` ne s'arrondit pas.
 */
export function isAmountMatching(expectedXaf: number, transaction: ProviderTransaction): boolean {
  return (
    transaction.currency.toUpperCase() === PAYMENT_CURRENCY &&
    Number.isSafeInteger(transaction.amount) &&
    transaction.amount === expectedXaf
  );
}
