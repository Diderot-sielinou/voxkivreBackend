import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { ConversionLimitExceededError } from '../../domain/errors/conversion-limit-exceeded.error';
import { QuotaExceededError } from '../../domain/errors/quota-exceeded.error';
import {
  UNITS_LEDGER,
  type UnitsLedgerPort,
  type UnitsReservation,
} from '../../domain/ports/units-ledger.port';
import { QUOTA_POLICY, type QuotaPolicy } from '../../domain/quota-policy';
import { allocate } from '../../domain/services/allocation';
import { QuotaPeriod } from '../../domain/value-objects/quota-period.vo';
import { Units, type VoiceTier } from '../../domain/value-objects/units.vo';

export interface ReserveQuotaInput {
  /** L'opération débitée (identifiant de conversion) : une seule réservation par opération. */
  readonly reservationId: string;
  readonly userId: string;
  readonly chars: number;
  readonly tier: VoiceTier;
}

/**
 * Réserve les unités d'une conversion **avant** toute dépense (ADR-0010,
 * ADR-0019) : refuse au-delà du plafond par conversion (RNF-25), sinon
 * répartit le coût gratuit → pass → crédits, ou refuse sans rien prendre.
 *
 * Appelé depuis la transaction de l'appelant (création de la conversion) :
 * le `UnitOfWork` réentrant la rejoint, donc conversion et réservation sont
 * écrites ensemble ou pas du tout. Réserver deux fois la même opération ne
 * débite qu'une fois.
 */
@Injectable()
export class ReserveQuotaUseCase {
  constructor(
    @Inject(UNITS_LEDGER) private readonly ledger: UnitsLedgerPort,
    @Inject(QUOTA_POLICY) private readonly policy: QuotaPolicy,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: ReserveQuotaInput): Promise<Result<UnitsReservation, DomainError>> {
    if (input.chars > this.policy.maxCharsPerConversion) {
      return Result.err(
        new ConversionLimitExceededError({
          requested: input.chars,
          maxChars: this.policy.maxCharsPerConversion,
        }),
      );
    }
    const now = this.clock.now();
    const period = QuotaPeriod.at(now);

    return this.uow.withTransaction(async (tx) => {
      const existing = await this.ledger.findReservation(input.reservationId, tx);
      if (existing !== null) return Result.ok(existing);

      const balances = await this.ledger.lockBalances(input.userId, period, now, tx);
      const available = {
        free: Units.of(Math.max(0, this.policy.freeTierUnitsPerMonth - balances.freeUsed)),
        pass: balances.activePass?.remaining ?? Units.of(0),
        credits: balances.credits,
      };
      const allocation = allocate({
        requested: Units.forChars(input.chars, input.tier),
        tier: input.tier,
        available,
      });
      if (allocation.isErr()) {
        const { requested, usable, tier } = allocation.error;
        return Result.err(new QuotaExceededError({ requested, usable, tier, available, period }));
      }

      const reservation = {
        reservationId: input.reservationId,
        userId: input.userId,
        period,
        tier: input.tier,
        chars: input.chars,
        passId: allocation.value.pass > 0 ? (balances.activePass?.id ?? null) : null,
        taken: allocation.value,
      };
      await this.ledger.recordReservation(reservation, now, tx);
      return Result.ok({ ...reservation, refunded: false });
    });
  }
}
