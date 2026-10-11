import { Inject, Injectable } from '@nestjs/common';

import { type Offer } from '../../domain/offer';
import { OFFER_CATALOG, type OfferCatalogPort } from '../../domain/ports/offer-catalog.port';
import { VOICE_TIER_WEIGHTS, type VoiceTier } from '../../domain/value-objects/units.vo';

export interface OfferCatalog {
  readonly offers: readonly Offer[];
  /** Unités par caractère selon la gamme de voix : le mobile estime le coût d'un livre. */
  readonly voiceTierWeights: Readonly<Record<VoiceTier, number>>;
}

/** `GET /v1/billing/offers` : ce qui est en vente, et comment les unités se consomment (ADR-0019). */
@Injectable()
export class ListOffersUseCase {
  constructor(@Inject(OFFER_CATALOG) private readonly catalog: OfferCatalogPort) {}

  async execute(): Promise<OfferCatalog> {
    return { offers: await this.catalog.listActive(), voiceTierWeights: VOICE_TIER_WEIGHTS };
  }
}
