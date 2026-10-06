import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RescheduleStalledExtractionsUseCase } from '../../application/use-cases/reschedule-stalled-extractions.use-case';

/**
 * Toutes les 5 minutes : reprogramme les extractions jamais lancées (file
 * indisponible à la confirmation). Sans risque de doublon (`jobId`
 * déterministe), donc sans verrou entre instances.
 */
@Injectable()
export class RescheduleStalledExtractionsJob {
  private readonly logger = new Logger(RescheduleStalledExtractionsJob.name);

  constructor(private readonly reschedule: RescheduleStalledExtractionsUseCase) {}

  @Cron('*/5 * * * *', { name: 'document-reschedule-stalled-extractions' })
  async run(): Promise<void> {
    try {
      const scheduled = await this.reschedule.execute();
      if (scheduled > 0) this.logger.warn({ scheduled }, 'Stalled extractions rescheduled');
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Stalled extraction sweep failed');
    }
  }
}
