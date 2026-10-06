import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RescheduleStalledConversionsUseCase } from '../../application/use-cases/reschedule-stalled-conversions.use-case';

/**
 * Toutes les 5 minutes : reprogramme les conversions bloquées (file
 * indisponible au lancement, tâches perdues). Sans risque de doublon
 * (`jobId` déterministes), donc sans verrou entre instances.
 */
@Injectable()
export class RescheduleStalledConversionsJob {
  private readonly logger = new Logger(RescheduleStalledConversionsJob.name);

  constructor(private readonly reschedule: RescheduleStalledConversionsUseCase) {}

  @Cron('*/5 * * * *', { name: 'conversion-reschedule-stalled' })
  async run(): Promise<void> {
    try {
      const rescheduled = await this.reschedule.execute();
      if (rescheduled > 0) this.logger.warn({ rescheduled }, 'Stalled conversions rescheduled');
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Stalled conversion sweep failed');
    }
  }
}
