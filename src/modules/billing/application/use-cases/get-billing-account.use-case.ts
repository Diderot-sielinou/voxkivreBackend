import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { UNITS_LEDGER, type UnitsLedgerPort } from '../../domain/ports/units-ledger.port';
import { QUOTA_POLICY, type QuotaPolicy } from '../../domain/quota-policy';
import { QuotaPeriod } from '../../domain/value-objects/quota-period.vo';

export interface BillingAccount {
  readonly period: string;
  readonly free: { readonly limit: number; readonly used: number; readonly remaining: number };
  readonly pass: {
    readonly endsAt: Date;
    readonly includedUnits: number;
    readonly usedUnits: number;
    readonly remainingUnits: number;
  } | null;
  readonly nextPassStartsAt: Date | null;
  readonly credits: number;
  readonly maxCharsPerConversion: number;
}

/**
 * `GET /v1/billing/account` : ce qu'il reste dans chaque source (ADR-0019),
 * à afficher avant de lancer une conversion et sur l'écran « Abonnement et
 * crédits ».
 */
@Injectable()
export class GetBillingAccountUseCase {
  constructor(
    @Inject(UNITS_LEDGER) private readonly ledger: UnitsLedgerPort,
    @Inject(QUOTA_POLICY) private readonly policy: QuotaPolicy,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(userId: string): Promise<BillingAccount> {
    const now = this.clock.now();
    const period = QuotaPeriod.at(now);
    const balances = await this.ledger.balances(userId, period, now);
    const limit = this.policy.freeTierUnitsPerMonth;
    const pass = balances.currentPass;
    return {
      period,
      free: {
        limit,
        used: balances.freeUsed,
        remaining: Math.max(0, limit - balances.freeUsed),
      },
      pass:
        pass === null
          ? null
          : {
              endsAt: pass.endsAt,
              includedUnits: pass.includedUnits,
              usedUnits: pass.usedUnits,
              remainingUnits: Math.max(0, pass.includedUnits - pass.usedUnits),
            },
      nextPassStartsAt: balances.nextPassStartsAt,
      credits: balances.credits,
      maxCharsPerConversion: this.policy.maxCharsPerConversion,
    };
  }
}
