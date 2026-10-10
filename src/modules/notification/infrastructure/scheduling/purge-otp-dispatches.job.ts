import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PurgeOtpDispatchesUseCase } from '../../application/use-cases/purge-otp-dispatches.use-case';

/** Purge quotidienne du journal des envois (03:30 UTC, heure creuse au Cameroun). */
@Injectable()
export class PurgeOtpDispatchesJob {
  private readonly logger = new Logger(PurgeOtpDispatchesJob.name);

  constructor(private readonly purge: PurgeOtpDispatchesUseCase) {}

  @Cron('30 3 * * *', { name: 'notification-purge-otp-dispatches', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      const purged = await this.purge.execute();
      this.logger.log({ purged }, 'Old OTP dispatch records purged');
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'OTP dispatch log purge failed');
    }
  }
}
