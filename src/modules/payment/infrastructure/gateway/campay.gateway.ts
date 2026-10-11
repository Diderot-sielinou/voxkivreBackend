import { z } from 'zod';

import { Result } from '@/shared/kernel';

import { InvalidPaymentNotificationError } from '../../domain/errors/invalid-payment-notification.error';
import { InvalidPaymentPhoneError } from '../../domain/errors/invalid-payment-phone.error';
import { PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import {
  type CollectRequest,
  type NotificationTarget,
  type PaymentGatewayPort,
} from '../../domain/ports/payment-gateway.port';
import { type ProviderTransaction } from '../../domain/provider-transaction';
import { MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';
import { PaymentProvider } from '../../domain/value-objects/payment-status.vo';

import { isValidHs256Jwt } from './hs256-jwt';

/** Un appel au prestataire ne bloque pas la requête plus longtemps (ADR-0021 §14). */
const REQUEST_TIMEOUT_MS = 5000;

/** `ER101` numéro invalide, `ER102` opérateur autre que MTN ou Orange. */
const PHONE_ERROR_CODES = /\bER10[12]\b/;

const collectResponse = z.object({ reference: z.string().min(1) });

const transactionResponse = z.object({
  reference: z.string().min(1),
  // Campay renvoie `""` quand aucune référence n'a été envoyée.
  external_reference: z
    .string()
    .nullish()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  status: z.enum(['PENDING', 'SUCCESSFUL', 'FAILED']),
  // Décimal (`2.0`) ou chaîne selon les points d'accès : comparé ensuite sans arrondi.
  amount: z.coerce.number(),
  currency: z.string().min(1),
});

const notification = z.object({
  signature: z.string().min(1),
  reference: z.string().min(1),
  external_reference: z.string().nullish(),
});

const STATUS: Record<z.infer<typeof transactionResponse>['status'], ProviderTransaction['status']> =
  {
    PENDING: 'pending',
    SUCCESSFUL: 'successful',
    FAILED: 'failed',
  };

export interface CampayCredentials {
  /** Racine de l'API, `/api` compris : `https://demo.campay.net/api` ou `https://www.campay.net/api`. */
  readonly baseUrl: string;
  /** Jeton permanent de l'application (ADR-0021 §14). */
  readonly token: string;
  /** Clé qui signe les notifications (JWT HS256). */
  readonly webhookKey: string;
}

export interface CampayOptions {
  /** Injectables pour les tests (serveur local, horloge). */
  readonly fetchFn?: typeof fetch;
  readonly nowSeconds?: () => number;
}

/**
 * Mobile Money par Campay (ADR-0021) : `POST /collect/` envoie la demande
 * au téléphone (idempotent sur `external_reference`), `GET /transaction/{ref}/`
 * relit l'état. Les erreurs ne recopient jamais le corps d'une réponse :
 * il peut citer le numéro du client.
 */
export class CampayGateway implements PaymentGatewayPort {
  readonly provider = PaymentProvider.CAMPAY;

  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly nowSeconds: () => number;

  constructor(
    private readonly credentials: CampayCredentials,
    options: CampayOptions = {},
  ) {
    this.baseUrl = withoutTrailingSlashes(credentials.baseUrl);
    this.fetchFn = options.fetchFn ?? fetch;
    this.nowSeconds = options.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));
  }

  async collect(
    request: CollectRequest,
  ): Promise<
    Result<{ readonly reference: string }, InvalidPaymentPhoneError | PaymentUnavailableError>
  > {
    const response = await this.call('collect', '/collect/', {
      method: 'POST',
      body: JSON.stringify({
        // Entier en chaîne, comme dans la documentation (ER201 sinon).
        amount: String(request.amountXaf),
        currency: 'XAF',
        from: MobileMoneyNumber.digits(request.phone),
        description: request.description,
        external_reference: request.externalReference,
      }),
    });
    if (response.isErr()) return Result.err(response.error);

    const { status, body } = response.value;
    if (status === 200) {
      const parsed = collectResponse.safeParse(parseJson(body));
      return parsed.success
        ? Result.ok({ reference: parsed.data.reference })
        : Result.err(unavailable('collect', status, 'unexpected response'));
    }
    if (status >= 400 && status < 500 && PHONE_ERROR_CODES.test(body)) {
      return Result.err(
        new InvalidPaymentPhoneError('Mobile Money number refused by the payment provider'),
      );
    }
    return Result.err(unavailable('collect', status));
  }

  async getTransaction(
    reference: string,
  ): Promise<Result<ProviderTransaction, PaymentUnavailableError>> {
    const response = await this.call(
      'transaction',
      `/transaction/${encodeURIComponent(reference)}/`,
      { method: 'GET' },
    );
    if (response.isErr()) return Result.err(response.error);

    const { status, body } = response.value;
    if (status !== 200) return Result.err(unavailable('transaction', status));
    const parsed = transactionResponse.safeParse(parseJson(body));
    if (!parsed.success) {
      return Result.err(unavailable('transaction', status, 'unexpected response'));
    }
    const data = parsed.data;
    return Result.ok({
      reference: data.reference,
      externalReference: data.external_reference,
      status: STATUS[data.status],
      amount: data.amount,
      currency: data.currency,
    });
  }

  verifyNotification(
    payload: Readonly<Record<string, unknown>>,
  ): Result<NotificationTarget, InvalidPaymentNotificationError> {
    const parsed = notification.safeParse(payload);
    if (
      !parsed.success ||
      !isValidHs256Jwt(parsed.data.signature, this.credentials.webhookKey, this.nowSeconds())
    ) {
      return Result.err(new InvalidPaymentNotificationError('Invalid payment notification'));
    }
    const externalReference = parsed.data.external_reference;
    return Result.ok({
      reference: parsed.data.reference,
      externalReference:
        externalReference === undefined || externalReference === null || externalReference === ''
          ? null
          : externalReference,
    });
  }

  /** Appel HTTP ; réseau coupé ou délai dépassé → indisponible (RNF-11). */
  private async call(
    step: 'collect' | 'transaction',
    path: string,
    init: { readonly method: 'GET' | 'POST'; readonly body?: string },
  ): Promise<Result<{ readonly status: number; readonly body: string }, PaymentUnavailableError>> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Token ${this.credentials.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return Result.ok({ status: response.status, body: await response.text() });
    } catch (error) {
      return Result.err(
        new PaymentUnavailableError(`Campay ${step} unreachable`, { cause: error }),
      );
    }
  }
}

function unavailable(
  step: 'collect' | 'transaction',
  status: number,
  reason?: string,
): PaymentUnavailableError {
  const suffix = reason === undefined ? '' : `, ${reason}`;
  return new PaymentUnavailableError(`Campay ${step} failed (HTTP ${String(status)}${suffix})`);
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // Corps non JSON (page d'erreur d'un proxy) : refusé par le schéma.
    return null;
  }
}
