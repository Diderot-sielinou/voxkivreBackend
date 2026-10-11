import { Injectable } from '@nestjs/common';

import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { PaymentActivity } from '@/modules/payment/application/services/payment-activity.service';

import {
  type AccountActivityPort,
  type AccountDeletionBlocker,
} from '../../domain/ports/account-activity.port';

/** Port `AccountActivity` branché sur les services exportés par `conversion` et `payment`. */
@Injectable()
export class ModulesAccountActivity implements AccountActivityPort {
  constructor(
    private readonly conversions: ConversionCatalog,
    private readonly payments: PaymentActivity,
  ) {}

  async findBlocker(userId: string, tx: unknown): Promise<AccountDeletionBlocker | null> {
    const { running } = await this.conversions.cleanupForOwner(userId, tx);
    if (running) return 'conversion_in_progress';
    return (await this.payments.hasPending(userId, tx)) ? 'payment_pending' : null;
  }
}
