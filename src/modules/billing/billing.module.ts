import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { IdentityModule } from '../identity/identity.module';

import { GetQuotaUseCase } from './application/use-cases/get-quota.use-case';
import { RefundQuotaUseCase } from './application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from './application/use-cases/reserve-quota.use-case';
import { QUOTA_LEDGER } from './domain/ports/quota-ledger.port';
import { QUOTA_POLICY, type QuotaPolicy } from './domain/quota-policy';
import { buildQuotaPolicy } from './infrastructure/config/quota-policy.factory';
import { DrizzleQuotaLedger } from './infrastructure/persistence/quota-ledger.drizzle-repository';
import { QuotaController } from './interface/http/quota.controller';

/**
 * Module billing, version minimale (ADR-0010) : quota mensuel en caractères,
 * réservé au lancement d'une conversion et remboursé si elle échoue.
 * Abonnements, crédits et paiement viendront aux étapes 4 et 5, derrière les
 * mêmes use-cases exportés.
 */
@Module({
  imports: [IdentityModule],
  controllers: [QuotaController],
  providers: [
    { provide: QUOTA_LEDGER, useClass: DrizzleQuotaLedger },
    {
      provide: QUOTA_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): QuotaPolicy => buildQuotaPolicy(config),
    },
    ReserveQuotaUseCase,
    RefundQuotaUseCase,
    GetQuotaUseCase,
  ],
  exports: [ReserveQuotaUseCase, RefundQuotaUseCase],
})
export class BillingModule {}
