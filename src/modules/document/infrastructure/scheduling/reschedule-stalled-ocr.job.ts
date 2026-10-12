import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RescheduleStalledOcrUseCase } from '../../application/use-cases/reschedule-stalled-ocr.use-case';

/**
 * Toutes les 5 minutes : relance les OCR immobiles depuis 30 min (lot non
 * programmé, tâche perdue — ADR-0024). Sans verrou entre instances : un lot
 * en double ne fait que réécrire les mêmes pages.
 */
@Injectable()
export class RescheduleStalledOcrJob {
  private readonly logger = new Logger(RescheduleStalledOcrJob.name);

  constructor(private readonly reschedule: RescheduleStalledOcrUseCase) {}

  @Cron('*/5 * * * *', { name: 'document-reschedule-stalled-ocr' })
  async run(): Promise<void> {
    try {
      const scheduled = await this.reschedule.execute();
      if (scheduled > 0) this.logger.warn({ scheduled }, 'Stalled OCR rescheduled');
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Stalled OCR sweep failed');
    }
  }
}
