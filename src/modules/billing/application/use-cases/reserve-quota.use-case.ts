import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { ConversionLimitExceededError } from '../../domain/errors/conversion-limit-exceeded.error';
import { QuotaExceededError } from '../../domain/errors/quota-exceeded.error';
import { QUOTA_LEDGER, type QuotaLedgerPort } from '../../domain/ports/quota-ledger.port';
import { QUOTA_POLICY, type QuotaPolicy } from '../../domain/quota-policy';
import { QuotaPeriod } from '../../domain/value-objects/quota-period.vo';

export interface ReserveQuotaInput {
  /** L'opération débitée (identifiant de conversion) : une seule réservation par opération. */
  readonly reservationId: string;
  readonly userId: string;
  readonly chars: number;
}

export interface QuotaReservation {
  readonly period: string;
  readonly reservedChars: number;
}

/**
 * Réserve des caractères sur le quota du mois **avant** toute dépense
 * (ADR-0010) : refuse au-delà du plafond par conversion (RNF-25) ou du
 * quota restant (RF-24).
 *
 * Appelé depuis la transaction de l'appelant (création de la conversion) :
 * le `UnitOfWork` réentrant rejoint cette transaction, donc conversion et
 * réservation sont écrites ensemble ou pas du tout. Réserver deux fois la
 * même opération ne débite qu'une fois.
 */
@Injectable()
export class ReserveQuotaUseCase {
  constructor(
    @Inject(QUOTA_LEDGER) private readonly ledger: QuotaLedgerPort,
    @Inject(QUOTA_POLICY) private readonly policy: QuotaPolicy,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: ReserveQuotaInput): Promise<Result<QuotaReservation, DomainError>> {
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
    const limit = this.policy.freeTierCharsPerMonth;
    const outcome =
      input.chars > limit
        ? 'exceeded'
        : await this.uow.withTransaction((tx) =>
            this.ledger.reserve(
              {
                reservationId: input.reservationId,
                userId: input.userId,
                period,
                chars: input.chars,
                limit,
                at: now,
              },
              tx,
            ),
          );
    if (outcome === 'exceeded') {
      const used = await this.ledger.usage(input.userId, period);
      return Result.err(
        new QuotaExceededError({
          requested: input.chars,
          remaining: Math.max(0, limit - used),
          limit,
          period,
        }),
      );
    }
    return Result.ok({ period, reservedChars: input.chars });
  }
}
