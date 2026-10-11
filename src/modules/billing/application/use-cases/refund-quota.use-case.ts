import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { UNITS_LEDGER, type UnitsLedgerPort } from '../../domain/ports/units-ledger.port';
import { splitRefund } from '../../domain/services/allocation';
import { Units } from '../../domain/value-objects/units.vo';

/**
 * Rend la part non consommée d'une réservation (conversion échouée,
 * ADR-0010) : `chars` caractères, convertis en unités avec la voix de la
 * réservation, rendus crédits → pass → gratuit (ADR-0019 §4). Idempotent :
 * une réservation n'est remboursée qu'une fois, même si l'échec est traité
 * deux fois. Renvoie `true` si des unités ont été rendues.
 */
@Injectable()
export class RefundQuotaUseCase {
  constructor(
    @Inject(UNITS_LEDGER) private readonly ledger: UnitsLedgerPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(reservationId: string, chars: number): Promise<boolean> {
    if (chars <= 0) return false;
    return this.uow.withTransaction(async (tx) => {
      const reservation = await this.ledger.findReservation(reservationId, tx, { lock: true });
      if (reservation === null || reservation.refunded) return false;
      const refundedChars = Math.min(chars, reservation.chars);
      const refund = splitRefund(
        reservation.taken,
        Units.forChars(refundedChars, reservation.tier),
      );
      return this.ledger.recordRefund(reservation, refund, refundedChars, this.clock.now(), tx);
    });
  }
}
