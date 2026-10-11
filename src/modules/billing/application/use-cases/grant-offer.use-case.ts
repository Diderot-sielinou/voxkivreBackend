import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { OfferNotFoundError } from '../../domain/errors/offer-not-found.error';
import { PaymentReferenceConflictError } from '../../domain/errors/payment-reference-conflict.error';
import { OFFER_CATALOG, type OfferCatalogPort } from '../../domain/ports/offer-catalog.port';
import {
  type GrantedPurchase,
  PURCHASE_LEDGER,
  type PurchaseLedgerPort,
} from '../../domain/ports/purchase-ledger.port';
import { grantFor, type PurchaseGrant } from '../../domain/services/purchase-grant';

export interface GrantOfferInput {
  readonly userId: string;
  readonly offerCode: string;
  /** Référence du paiement confirmé (agrégateur) : clé d'idempotence (RNF-09). */
  readonly paymentReference: string;
}

export interface GrantOfferOutput {
  /** `false` : ce paiement était déjà accordé, rien de plus n'est donné. */
  readonly granted: boolean;
  readonly grant: PurchaseGrant;
}

/**
 * Accorde une offre payée (ADR-0019 §9) : appelé par le module `payment`
 * une fois le paiement confirmé — aucune route HTTP. **Idempotent par
 * référence de paiement** : un webhook rejoué ou une réconciliation
 * n'accorde jamais deux fois.
 */
@Injectable()
export class GrantOfferUseCase {
  constructor(
    @Inject(OFFER_CATALOG) private readonly catalog: OfferCatalogPort,
    @Inject(PURCHASE_LEDGER) private readonly purchases: PurchaseLedgerPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: GrantOfferInput): Promise<Result<GrantOfferOutput, DomainError>> {
    const offer = await this.catalog.findByCode(input.offerCode);
    if (offer === null) return Result.err(new OfferNotFoundError(input.offerCode));

    return this.uow.withTransaction(async (tx) => {
      const existing = await this.purchases.findPurchase(input.paymentReference, tx);
      if (existing !== null) return this.alreadyGranted(existing, input);

      const now = this.clock.now();
      const latestPassEnd = await this.purchases.lockForPurchase(input.userId, now, tx);
      const grant = grantFor(offer, now, latestPassEnd);
      const recorded = await this.purchases.recordPurchase(
        { paymentReference: input.paymentReference, userId: input.userId, grant },
        now,
        tx,
      );
      if (recorded) return Result.ok({ granted: true, grant });

      // Une requête concurrente a accordé la même référence pendant ce temps.
      const winner = await this.purchases.findPurchase(input.paymentReference, tx);
      if (winner === null) throw new Error('Purchase vanished after a reference conflict');
      return this.alreadyGranted(winner, input);
    });
  }

  /** Même utilisateur et même offre : rien de plus ; sinon conflit signalé. */
  private alreadyGranted(
    existing: GrantedPurchase,
    input: GrantOfferInput,
  ): Result<GrantOfferOutput, DomainError> {
    const same = existing.userId === input.userId && existing.grant.offerCode === input.offerCode;
    return same
      ? Result.ok({ granted: false, grant: existing.grant })
      : Result.err(new PaymentReferenceConflictError(input.paymentReference));
  }
}
