import { createHmac } from 'node:crypto';

import { Result } from '@/shared/kernel';

import { InvalidPaymentNotificationError } from '../../domain/errors/invalid-payment-notification.error';
import { PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import {
  type CollectRequest,
  type NotificationTarget,
  type PaymentGatewayPort,
} from '../../domain/ports/payment-gateway.port';
import { type ProviderTransaction } from '../../domain/provider-transaction';
import { PaymentProvider } from '../../domain/value-objects/payment-status.vo';

import { isValidHs256Jwt } from './hs256-jwt';

/** Clé de signature des notifications factices : pas un secret (refusé en production). */
export const FAKE_WEBHOOK_KEY = 'voxlivre-fake-payment-webhook-key';

/** Un numéro qui se termine ainsi voit son paiement refusé (ADR-0021 §15). */
const FAILING_SUFFIX = '00';

interface FakeTransaction {
  readonly externalReference: string;
  readonly amount: number;
  readonly fails: boolean;
}

/**
 * Prestataire factice (développement, e2e — ADR-0021 §15) : la demande est
 * acceptée, la transaction est conclue à la lecture suivante. Rien ne sort
 * de la mémoire du processus. `PAYMENT_PROVIDER=fake` est refusé en
 * production : il accorderait des offres sans paiement.
 */
export class FakeGateway implements PaymentGatewayPort {
  readonly provider = PaymentProvider.FAKE;

  private readonly transactions = new Map<string, FakeTransaction>();

  collect(
    request: CollectRequest,
  ): Promise<Result<{ readonly reference: string }, PaymentUnavailableError>> {
    // Même référence pour la même demande, comme Campay.
    const reference = `fake-${request.externalReference}`;
    this.transactions.set(reference, {
      externalReference: request.externalReference,
      amount: request.amountXaf,
      fails: request.phone.endsWith(FAILING_SUFFIX),
    });
    return Promise.resolve(Result.ok({ reference }));
  }

  getTransaction(reference: string): Promise<Result<ProviderTransaction, PaymentUnavailableError>> {
    const transaction = this.transactions.get(reference);
    if (transaction === undefined) {
      // Processus redémarré : la mémoire est perdue, comme une panne.
      return Promise.resolve(Result.err(new PaymentUnavailableError('Unknown fake transaction')));
    }
    return Promise.resolve(
      Result.ok({
        reference,
        externalReference: transaction.externalReference,
        status: transaction.fails ? 'failed' : 'successful',
        amount: transaction.amount,
        currency: 'XAF',
      }),
    );
  }

  verifyNotification(
    payload: Readonly<Record<string, unknown>>,
  ): Result<NotificationTarget, InvalidPaymentNotificationError> {
    const { signature, reference } = payload;
    if (
      typeof signature !== 'string' ||
      typeof reference !== 'string' ||
      !isValidHs256Jwt(signature, FAKE_WEBHOOK_KEY, Math.floor(Date.now() / 1000))
    ) {
      return Result.err(new InvalidPaymentNotificationError('Invalid payment notification'));
    }
    const externalReference = payload.external_reference;
    return Result.ok({
      reference,
      externalReference: typeof externalReference === 'string' ? externalReference : null,
    });
  }
}

/** Signature d'une notification factice, pour les e2e et le développement. */
export function signFakeNotification(): string {
  const unsigned = `${base64UrlJson({ typ: 'JWT', alg: 'HS256' })}.${base64UrlJson({})}`;
  // Clé factice publique par construction : le prestataire `fake` est refusé
  // en production (schéma d'env).
  // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- invariant ci-dessus
  const signature = createHmac('sha256', FAKE_WEBHOOK_KEY).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
