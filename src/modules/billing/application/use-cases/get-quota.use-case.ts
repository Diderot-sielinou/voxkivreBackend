import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { QUOTA_LEDGER, type QuotaLedgerPort } from '../../domain/ports/quota-ledger.port';
import { QUOTA_POLICY, type QuotaPolicy } from '../../domain/quota-policy';
import { QuotaPeriod } from '../../domain/value-objects/quota-period.vo';

export interface QuotaStatus {
  readonly period: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly maxCharsPerConversion: number;
}

/** `GET /v1/quota` : ce qu'il reste ce mois-ci, à afficher avant de lancer une conversion (RF-24). */
@Injectable()
export class GetQuotaUseCase {
  constructor(
    @Inject(QUOTA_LEDGER) private readonly ledger: QuotaLedgerPort,
    @Inject(QUOTA_POLICY) private readonly policy: QuotaPolicy,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(userId: string): Promise<QuotaStatus> {
    const period = QuotaPeriod.at(this.clock.now());
    const limit = this.policy.freeTierCharsPerMonth;
    const used = await this.ledger.usage(userId, period);
    return {
      period,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      maxCharsPerConversion: this.policy.maxCharsPerConversion,
    };
  }
}
