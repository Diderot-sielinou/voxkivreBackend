import { Injectable } from '@nestjs/common';

import { GrantOfferUseCase } from '@/modules/billing/application/use-cases/grant-offer.use-case';
import { ListOffersUseCase } from '@/modules/billing/application/use-cases/list-offers.use-case';
import { type DomainError, Result } from '@/shared/kernel';

import { type BillingPort, type PayableOffer } from '../../domain/ports/billing.port';

/**
 * Port `Billing` branché sur les use-cases exportés par `BillingModule`
 * (ADR-0019 §9). `GrantOffer` rejoint la transaction de l'appelant grâce au
 * `UnitOfWork` réentrant.
 */
@Injectable()
export class BillingAdapter implements BillingPort {
  constructor(
    private readonly listOffers: ListOffersUseCase,
    private readonly grantOffer: GrantOfferUseCase,
  ) {}

  async findOffer(code: string): Promise<PayableOffer | null> {
    // Catalogue de quatre offres : lire la liste active suffit, et écarte
    // d'office une offre retirée.
    const { offers } = await this.listOffers.execute();
    const offer = offers.find((candidate) => candidate.code === code);
    if (offer === undefined) return null;
    const common = { code: offer.code, priceXaf: offer.price, units: offer.units };
    return offer.kind === 'pass'
      ? { ...common, kind: 'pass', durationDays: offer.durationDays }
      : { ...common, kind: 'credits' };
  }

  async grant(input: {
    readonly paymentReference: string;
    readonly userId: string;
    readonly offerCode: string;
  }): Promise<Result<void, DomainError>> {
    const granted = await this.grantOffer.execute(input);
    return granted.isErr() ? Result.err(granted.error) : Result.ok();
  }
}
