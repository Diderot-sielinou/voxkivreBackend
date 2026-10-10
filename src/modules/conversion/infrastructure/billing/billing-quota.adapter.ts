import { Injectable } from '@nestjs/common';

import { RefundQuotaUseCase } from '@/modules/billing/application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '@/modules/billing/application/use-cases/reserve-quota.use-case';
import { type DomainError, Result } from '@/shared/kernel';

import { type QuotaPort } from '../../domain/ports/quota.port';
import { type VoiceTier } from '../../domain/voices';

/**
 * Port `Quota` branché sur les use-cases exportés par `BillingModule`
 * (ADR-0010). Leurs transactions rejoignent celle de l'appelant grâce au
 * `UnitOfWork` réentrant.
 */
@Injectable()
export class BillingQuotaAdapter implements QuotaPort {
  constructor(
    private readonly reserveQuota: ReserveQuotaUseCase,
    private readonly refundQuota: RefundQuotaUseCase,
  ) {}

  async reserve(input: {
    readonly reservationId: string;
    readonly userId: string;
    readonly chars: number;
    readonly voiceTier: VoiceTier;
  }): Promise<Result<void, DomainError>> {
    const reserved = await this.reserveQuota.execute({
      reservationId: input.reservationId,
      userId: input.userId,
      chars: input.chars,
      tier: input.voiceTier,
    });
    return reserved.isErr() ? Result.err(reserved.error) : Result.ok();
  }

  async refund(reservationId: string, chars: number): Promise<void> {
    await this.refundQuota.execute(reservationId, chars);
  }
}
