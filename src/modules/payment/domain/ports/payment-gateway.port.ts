import { type Result } from '@/shared/kernel';

import { type InvalidPaymentNotificationError } from '../errors/invalid-payment-notification.error';
import { type InvalidPaymentPhoneError } from '../errors/invalid-payment-phone.error';
import { type PaymentUnavailableError } from '../errors/payment-unavailable.error';
import { type ProviderTransaction } from '../provider-transaction';
import { type MobileMoneyNumber } from '../value-objects/mobile-money-number.vo';
import { type PaymentProvider } from '../value-objects/payment-status.vo';

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

export interface CollectRequest {
  /** UUID v4 : renvoyer la même demande redonne la même transaction (§7). */
  readonly externalReference: string;
  readonly amountXaf: number;
  readonly phone: MobileMoneyNumber;
  readonly description: string;
}

/**
 * Ce qu'une notification **signée** désigne : de quoi retrouver le
 * paiement, rien de plus. Son statut et son montant ne sont pas lus, l'état
 * est relu chez le prestataire (ADR-0021 §3).
 */
export interface NotificationTarget {
  readonly reference: string;
  readonly externalReference: string | null;
}

/**
 * Prestataire Mobile Money (RNF-17 : un autre = un nouvel adapter).
 * Pannes réseau, délais dépassés et réponses inexploitables →
 * `PaymentUnavailableError` ; jamais d'exception.
 */
export interface PaymentGatewayPort {
  /**
   * `null` : paiement **désactivé** (production avant l'ouverture chez le
   * prestataire) ; aucune demande n'est créée, la route répond 503.
   */
  readonly provider: PaymentProvider | null;

  /** Envoie la demande au téléphone ; renvoie la référence du prestataire. */
  collect(
    request: CollectRequest,
  ): Promise<
    Result<{ readonly reference: string }, InvalidPaymentPhoneError | PaymentUnavailableError>
  >;

  /** État de la transaction, relu avec nos identifiants. */
  getTransaction(reference: string): Promise<Result<ProviderTransaction, PaymentUnavailableError>>;

  /** Vérifie la signature d'une notification reçue (corps ou paramètres). */
  verifyNotification(
    payload: Readonly<Record<string, unknown>>,
  ): Result<NotificationTarget, InvalidPaymentNotificationError>;
}
