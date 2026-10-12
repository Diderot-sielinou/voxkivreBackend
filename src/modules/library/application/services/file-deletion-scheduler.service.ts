import { Inject, Injectable } from '@nestjs/common';

import {
  FILE_DELETION_OUTBOX,
  type FileDeletionOutboxPort,
} from '../../domain/ports/file-deletion-outbox.port';

/**
 * L'outbox des fichiers **pour les autres modules** (suppression du compte,
 * ADR-0023) : exporté par `LibraryModule`. Les clés sont effacées par le
 * balayage de la bibliothèque (ADR-0016).
 */
@Injectable()
export class FileDeletionScheduler {
  constructor(@Inject(FILE_DELETION_OUTBOX) private readonly outbox: FileDeletionOutboxPort) {}

  /** Dans la transaction `tx` de la suppression des lignes (doublons ignorés). */
  schedule(keys: readonly string[], requestedAt: Date, tx: unknown): Promise<void> {
    return this.outbox.add(keys, requestedAt, tx);
  }
}
