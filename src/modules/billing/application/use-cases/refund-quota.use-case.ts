import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { QUOTA_LEDGER, type QuotaLedgerPort } from '../../domain/ports/quota-ledger.port';

/**
 * Rend la part non consommée d'une réservation (conversion échouée,
 * ADR-0010). Idempotent : une réservation n'est remboursée qu'une fois, même
 * si l'échec est traité deux fois. Renvoie `true` si des caractères ont été
 * rendus.
 */
@Injectable()
export class RefundQuotaUseCase {
  constructor(
    @Inject(QUOTA_LEDGER) private readonly ledger: QuotaLedgerPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(reservationId: string, chars: number): Promise<boolean> {
    if (chars <= 0) return false;
    return this.uow.withTransaction((tx) =>
      this.ledger.refund(reservationId, chars, this.clock.now(), tx),
    );
  }
}
