import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PurgePendingFileDeletionsUseCase } from '../../application/use-cases/purge-pending-file-deletions.use-case';

/**
 * Balayage de l'outbox des fichiers à effacer (ADR-0016), chaque minute :
 * une requête sur une table presque toujours vide. Aucune logique métier
 * ici : appel du use-case et log du rapport.
 */
@Injectable()
export class PurgePendingFileDeletionsJob {
  private readonly logger = new Logger(PurgePendingFileDeletionsJob.name);

  constructor(private readonly purge: PurgePendingFileDeletionsUseCase) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'library-purge-pending-file-deletions' })
  async run(): Promise<void> {
    try {
      const report = await this.purge.execute();
      if (report.deleted > 0) this.logger.log(report, 'Pending file deletions processed');
      if (report.failed > 0) {
        this.logger.warn(report, 'Some files could not be deleted; retrying next minute');
      }
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Pending file deletions sweep failed');
    }
  }
}
