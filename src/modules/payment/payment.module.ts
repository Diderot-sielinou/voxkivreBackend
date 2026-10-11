import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { BillingModule } from '../billing/billing.module';
import { IdentityModule } from '../identity/identity.module';

import { PaymentSettler } from './application/services/payment-settler.service';
import { GetPaymentUseCase } from './application/use-cases/get-payment.use-case';
import { HandlePaymentNotificationUseCase } from './application/use-cases/handle-payment-notification.use-case';
import { InitiatePaymentUseCase } from './application/use-cases/initiate-payment.use-case';
import { ReconcilePendingPaymentsUseCase } from './application/use-cases/reconcile-pending-payments.use-case';
import { BILLING } from './domain/ports/billing.port';
import { PAYMENT_GATEWAY } from './domain/ports/payment-gateway.port';
import { PAYMENT_REPOSITORY } from './domain/ports/payment-repository.port';
import { PHONE_HASHER } from './domain/ports/phone-hasher.port';
import { BillingAdapter } from './infrastructure/billing/billing.adapter';
import { buildPaymentGateway } from './infrastructure/config/payment-gateway.factory';
import { DrizzlePaymentRepository } from './infrastructure/persistence/payment.drizzle-repository';
import { ReconcilePaymentsJob } from './infrastructure/scheduling/reconcile-payments.job';
import { HmacPhoneHasher } from './infrastructure/security/hmac-phone-hasher';
import { PaymentWebhooksController } from './interface/http/payment-webhooks.controller';
import { PaymentsController } from './interface/http/payments.controller';

/**
 * Module payment (RF-23, ADR-0021) : paiement d'une offre par Mobile Money
 * (Campay), notifications reconfirmées chez le prestataire, réconciliation
 * toutes les 5 minutes. L'offre est accordée par `BillingModule`, derrière
 * le port `Billing`. `UNIT_OF_WORK`, `CLOCK` et `DRIZZLE_CLIENT` viennent des
 * modules globaux.
 */
@Module({
  imports: [IdentityModule, BillingModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: buildPaymentGateway,
    },
    {
      provide: PHONE_HASHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): HmacPhoneHasher =>
        new HmacPhoneHasher(config.get('BETTER_AUTH_SECRET', { infer: true })),
    },
    { provide: PAYMENT_REPOSITORY, useClass: DrizzlePaymentRepository },
    { provide: BILLING, useClass: BillingAdapter },
    PaymentSettler,
    InitiatePaymentUseCase,
    GetPaymentUseCase,
    HandlePaymentNotificationUseCase,
    ReconcilePendingPaymentsUseCase,
    ReconcilePaymentsJob,
  ],
})
export class PaymentModule {}
