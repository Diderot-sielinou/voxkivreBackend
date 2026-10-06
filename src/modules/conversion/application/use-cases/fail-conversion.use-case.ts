import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { QUOTA, type QuotaPort } from '../../domain/ports/quota.port';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { type ConversionFailureReason } from '../../domain/value-objects/conversion-status.vo';

/**
 * Échec définitif d'une conversion (RNF-11 : l'utilisateur est informé par
 * le statut, jamais d'échec silencieux) : passage en `failed` et
 * remboursement de la part non consommée (ADR-0010), dans une transaction.
 *
 * Idempotent : une conversion déjà terminée n'est ni modifiée ni
 * remboursée une seconde fois. Renvoie `true` si c'est cet appel qui l'a
 * fait échouer.
 */
@Injectable()
export class FailConversionUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(QUOTA) private readonly quota: QuotaPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(id: ConversionId, reason: ConversionFailureReason): Promise<boolean> {
    return this.uow.withTransaction(async (tx) => {
      const charge = await this.conversions.markFailed(id, reason, this.clock.now(), tx);
      if (charge === null) return false;
      await this.quota.refund(id, charge.reservedChars - charge.consumedChars);
      return true;
    });
  }
}
