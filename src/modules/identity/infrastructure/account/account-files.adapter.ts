import { Injectable } from '@nestjs/common';

import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { DocumentCatalog } from '@/modules/document/application/services/document-catalog.service';
import { FileDeletionScheduler } from '@/modules/library/application/services/file-deletion-scheduler.service';

import { type AccountFilesPort } from '../../domain/ports/account-files.port';

/**
 * Port `AccountFiles` : les clés viennent des modules qui les connaissent
 * (`document`, `conversion`), l'outbox de `library` les efface (ADR-0016).
 * Le cache TTS partagé n'est pas lié au compte et reste en place.
 */
@Injectable()
export class ModulesAccountFiles implements AccountFilesPort {
  constructor(
    private readonly documents: DocumentCatalog,
    private readonly conversions: ConversionCatalog,
    private readonly outbox: FileDeletionScheduler,
  ) {}

  async scheduleDeletion(userId: string, requestedAt: Date, tx: unknown): Promise<number> {
    const sources = await this.documents.liveSourceKeysForOwner(userId, tx);
    const { fileKeys } = await this.conversions.cleanupForOwner(userId, tx);
    const keys = [...sources, ...fileKeys];
    await this.outbox.schedule(keys, requestedAt, tx);
    return keys.length;
  }
}
