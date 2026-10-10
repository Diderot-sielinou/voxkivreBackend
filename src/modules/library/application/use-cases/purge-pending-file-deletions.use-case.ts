import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import {
  FILE_DELETION_OUTBOX,
  type FileDeletionOutboxPort,
} from '../../domain/ports/file-deletion-outbox.port';

/** Plafond par passage : borne la durée d'un balayage (le suivant reprend la suite). */
export const FILE_DELETION_BATCH_SIZE = 200;

export interface FileDeletionReport {
  readonly deleted: number;
  readonly failed: number;
}

/**
 * Vide l'outbox (ADR-0016) : efface chaque fichier (idempotent : un objet
 * absent n'est pas une erreur), puis sa ligne. Une panne du stockage laisse
 * la ligne pour le passage suivant — jamais de fichier oublié. Plusieurs
 * instances peuvent balayer en même temps sans risque.
 */
@Injectable()
export class PurgePendingFileDeletionsUseCase {
  constructor(
    @Inject(FILE_DELETION_OUTBOX) private readonly outbox: FileDeletionOutboxPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<FileDeletionReport> {
    const pending = await this.outbox.listPending(FILE_DELETION_BATCH_SIZE);
    let deleted = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        await this.storage.delete(item.key);
        await this.outbox.remove(item.key);
        deleted += 1;
      } catch (error) {
        // Le nom seul : un message de fournisseur peut contenir n'importe quoi (cf. ADR-0014).
        const name = error instanceof Error ? error.name : 'UnknownError';
        await this.outbox.recordFailure(item.key, name, this.clock.now());
        failed += 1;
      }
    }
    return { deleted, failed };
  }
}
