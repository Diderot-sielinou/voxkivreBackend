import { InvalidPaymentNotificationError } from '@/modules/payment/domain/errors/invalid-payment-notification.error';
import { type InvalidPaymentPhoneError } from '@/modules/payment/domain/errors/invalid-payment-phone.error';
import { PaymentUnavailableError } from '@/modules/payment/domain/errors/payment-unavailable.error';
import { type BillingPort, type PayableOffer } from '@/modules/payment/domain/ports/billing.port';
import {
  type CollectRequest,
  type NotificationTarget,
  type PaymentGatewayPort,
} from '@/modules/payment/domain/ports/payment-gateway.port';
import { type PhoneHasherPort } from '@/modules/payment/domain/ports/phone-hasher.port';
import { type ProviderTransaction } from '@/modules/payment/domain/provider-transaction';
import { type MobileMoneyNumber } from '@/modules/payment/domain/value-objects/mobile-money-number.vo';
import { type PaymentProvider } from '@/modules/payment/domain/value-objects/payment-status.vo';
import { type DomainError, Result } from '@/shared/kernel';

/** Catalogue de l'ADR-0019, tel que `payment` le voit. */
export const PAYABLE_OFFERS: readonly PayableOffer[] = [
  { code: 'pass-30d', kind: 'pass', priceXaf: 2000, units: 250_000, durationDays: 30 },
  { code: 'credits-s', kind: 'credits', priceXaf: 500, units: 50_000 },
];

/** Billing scriptable : offres en vente et accords enregistrés. */
export class FakeBilling implements BillingPort {
  readonly grants: { paymentReference: string; userId: string; offerCode: string }[] = [];
  grantError: DomainError | null = null;

  constructor(private readonly offers: readonly PayableOffer[] = PAYABLE_OFFERS) {}

  findOffer(code: string): Promise<PayableOffer | null> {
    return Promise.resolve(this.offers.find((o) => o.code === code) ?? null);
  }

  grant(input: {
    readonly paymentReference: string;
    readonly userId: string;
    readonly offerCode: string;
  }): Promise<Result<void, DomainError>> {
    if (this.grantError !== null) return Promise.resolve(Result.err(this.grantError));
    this.grants.push({ ...input });
    return Promise.resolve(Result.ok());
  }
}

/**
 * Prestataire scriptable : chaque test fixe la réponse de `collect`, l'état
 * relu et le résultat de la vérification. Enregistre les appels.
 */
export class ScriptedGateway implements PaymentGatewayPort {
  readonly collected: CollectRequest[] = [];
  readonly read: string[] = [];
  collectResult: Result<
    { readonly reference: string },
    InvalidPaymentPhoneError | PaymentUnavailableError
  > = Result.ok({ reference: 'campay-ref' });
  /** `null` → prestataire injoignable. */
  transaction: Partial<ProviderTransaction> | null = { status: 'pending' };
  notification: NotificationTarget | null = { reference: 'campay-ref', externalReference: null };

  constructor(readonly provider: PaymentProvider | null = 'campay') {}

  collect(
    request: CollectRequest,
  ): Promise<
    Result<{ readonly reference: string }, InvalidPaymentPhoneError | PaymentUnavailableError>
  > {
    this.collected.push(request);
    return Promise.resolve(this.collectResult);
  }

  /**
   * L'état relu reprend par défaut la référence externe et le montant du
   * dernier paiement demandé : un test ne fixe que ce qui l'intéresse.
   */
  getTransaction(reference: string): Promise<Result<ProviderTransaction, PaymentUnavailableError>> {
    this.read.push(reference);
    if (this.transaction === null) {
      return Promise.resolve(
        Result.err(new PaymentUnavailableError('Campay transaction unreachable')),
      );
    }
    const last = this.collected.at(-1);
    return Promise.resolve(
      Result.ok({
        reference,
        externalReference: last?.externalReference ?? null,
        status: 'pending',
        amount: last?.amountXaf ?? 0,
        currency: 'XAF',
        ...this.transaction,
      }),
    );
  }

  verifyNotification(): Result<NotificationTarget, InvalidPaymentNotificationError> {
    return this.notification === null
      ? Result.err(new InvalidPaymentNotificationError('Invalid payment notification'))
      : Result.ok(this.notification);
  }
}

/** Empreinte lisible en test : `hmac(<numéro>)`, sur 64 caractères. */
export class FakePhoneHasher implements PhoneHasherPort {
  keyOf(phone: MobileMoneyNumber): string {
    return `hmac(${phone})`.padEnd(64, '.');
  }
}
