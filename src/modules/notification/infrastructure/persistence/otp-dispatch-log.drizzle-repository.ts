import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, lt } from 'drizzle-orm';

import { uuidV7 } from '@/shared/kernel';
import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type OtpChannel } from '../../domain/otp-dispatch';
import { type OtpDispatchLogPort } from '../../domain/ports/otp-dispatch-log.port';

import { otpDispatches } from './schema/notification.schema';

/** Journal des envois en SQL (ADR-0017). */
@Injectable()
export class DrizzleOtpDispatchLog implements OtpDispatchLogPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async record(channel: OtpChannel, destinationKey: string, at: Date): Promise<void> {
    await this.db
      .insert(otpDispatches)
      .values({ id: uuidV7(), channel, destinationKey, sentAt: at });
  }

  async countForDestinationSince(destinationKey: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(otpDispatches)
      .where(
        and(eq(otpDispatches.destinationKey, destinationKey), gte(otpDispatches.sentAt, since)),
      );
    return rows.at(0)?.n ?? 0;
  }

  async countForChannelSince(channel: OtpChannel, since: Date): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(otpDispatches)
      .where(and(eq(otpDispatches.channel, channel), gte(otpDispatches.sentAt, since)));
    return rows.at(0)?.n ?? 0;
  }

  async purgeBefore(before: Date): Promise<number> {
    const deleted = await this.db
      .delete(otpDispatches)
      .where(lt(otpDispatches.sentAt, before))
      .returning({ id: otpDispatches.id });
    return deleted.length;
  }
}
