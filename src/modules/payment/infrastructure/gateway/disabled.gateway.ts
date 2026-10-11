import { Result } from '@/shared/kernel';

import { InvalidPaymentNotificationError } from '../../domain/errors/invalid-payment-notification.error';
import { PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import {
  type NotificationTarget,
  type PaymentGatewayPort,
} from '../../domain/ports/payment-gateway.port';
import { type ProviderTransaction } from '../../domain/provider-transaction';

/**
 * Paiement désactivé (`PAYMENT_PROVIDER=disabled`) : la production tant que
 * l'ouverture chez le prestataire n'est pas faite. Le use-case refuse avant
 * de créer quoi que ce soit (`provider: null`) ; ces méthodes ne servent
 * qu'au cas où.
 */
export class DisabledGateway implements PaymentGatewayPort {
  readonly provider = null;

  collect(): Promise<Result<{ readonly reference: string }, PaymentUnavailableError>> {
    return Promise.resolve(Result.err(disabled()));
  }

  getTransaction(): Promise<Result<ProviderTransaction, PaymentUnavailableError>> {
    return Promise.resolve(Result.err(disabled()));
  }

  verifyNotification(): Result<NotificationTarget, InvalidPaymentNotificationError> {
    return Result.err(new InvalidPaymentNotificationError('Payments are disabled'));
  }
}

function disabled(): PaymentUnavailableError {
  return new PaymentUnavailableError('Payments are disabled');
}
