import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PurgeAbandonedUploadsUseCase } from '../../application/use-cases/purge-abandoned-uploads.use-case';

/**
 * Déclencheur quotidien (03:00 UTC, heure creuse au Cameroun) de la purge
 * des uploads abandonnés. Aucune logique métier ici : appel du use-case et
 * log du rapport.
 *
 * Plusieurs instances Railway lanceraient chacune la purge : sans risque
 * (suppressions conditionnelles et idempotentes), donc pas de verrou au MVP.
 */
@Injectable()
export class PurgeAbandonedUploadsJob {
  private readonly logger = new Logger(PurgeAbandonedUploadsJob.name);

  constructor(private readonly purge: PurgeAbandonedUploadsUseCase) {}

  @Cron('0 3 * * *', { name: 'document-purge-abandoned-uploads', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      const report = await this.purge.execute();
      this.logger.log({ purged: report.purged }, 'Abandoned document uploads purged');
      if (report.orphanKeys.length > 0) {
        this.logger.error(
          { orphanKeys: report.orphanKeys },
          'Purged documents left files in object storage',
        );
      }
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Abandoned document uploads purge failed');
    }
  }
}
