import { Injectable } from '@nestjs/common';

import { GetBillingAccountUseCase } from '@/modules/billing/application/use-cases/get-billing-account.use-case';

import { type PaidAccessPort } from '../../domain/ports/paid-access.port';

/**
 * Port `PaidAccess` branché sur le use-case exporté par `BillingModule`
 * (jamais sur ses repositories, dependency-injection.md). Un pass en cours,
 * même épuisé, ou des crédits restants : le compte n'est pas gratuit.
 */
@Injectable()
export class BillingPaidAccess implements PaidAccessPort {
  constructor(private readonly account: GetBillingAccountUseCase) {}

  async hasPaidAccess(userId: string): Promise<boolean> {
    const account = await this.account.execute(userId);
    return account.pass !== null || account.credits > 0;
  }
}
