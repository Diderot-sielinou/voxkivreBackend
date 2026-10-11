import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { IdentityModule } from '../identity/identity.module';

import { GetBillingAccountUseCase } from './application/use-cases/get-billing-account.use-case';
import { GrantOfferUseCase } from './application/use-cases/grant-offer.use-case';
import { ListOffersUseCase } from './application/use-cases/list-offers.use-case';
import { ListWalletEntriesUseCase } from './application/use-cases/list-wallet-entries.use-case';
import { RefundQuotaUseCase } from './application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from './application/use-cases/reserve-quota.use-case';
import { OFFER_CATALOG } from './domain/ports/offer-catalog.port';
import { PURCHASE_LEDGER } from './domain/ports/purchase-ledger.port';
import { UNITS_LEDGER } from './domain/ports/units-ledger.port';
import { WALLET_HISTORY } from './domain/ports/wallet-history.port';
import { QUOTA_POLICY, type QuotaPolicy } from './domain/quota-policy';
import { buildQuotaPolicy } from './infrastructure/config/quota-policy.factory';
import { DrizzleOfferCatalog } from './infrastructure/persistence/offer-catalog.drizzle-repository';
import { DrizzlePurchaseLedger } from './infrastructure/persistence/purchase-ledger.drizzle-repository';
import { DrizzleUnitsLedger } from './infrastructure/persistence/units-ledger.drizzle-repository';
import { DrizzleWalletHistory } from './infrastructure/persistence/wallet-history.drizzle-repository';
import { BillingController } from './interface/http/billing.controller';

/**
 * Module billing (ADR-0010, ADR-0019) : unités pondérées par la voix, prises
 * au palier gratuit, au pass puis aux crédits au lancement d'une conversion,
 * rendues si elle échoue. Exporte la réservation et le remboursement
 * (`conversion`) et l'octroi d'une offre payée (futur module `payment`).
 */
@Module({
  imports: [IdentityModule],
  controllers: [BillingController],
  providers: [
    { provide: UNITS_LEDGER, useClass: DrizzleUnitsLedger },
    { provide: PURCHASE_LEDGER, useClass: DrizzlePurchaseLedger },
    { provide: OFFER_CATALOG, useClass: DrizzleOfferCatalog },
    { provide: WALLET_HISTORY, useClass: DrizzleWalletHistory },
    {
      provide: QUOTA_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): QuotaPolicy => buildQuotaPolicy(config),
    },
    ReserveQuotaUseCase,
    RefundQuotaUseCase,
    GrantOfferUseCase,
    GetBillingAccountUseCase,
    ListOffersUseCase,
    ListWalletEntriesUseCase,
  ],
  exports: [ReserveQuotaUseCase, RefundQuotaUseCase, GrantOfferUseCase],
})
export class BillingModule {}
