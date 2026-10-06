import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import {
  DOCUMENT_UPLOAD_POLICY,
  type DocumentUploadPolicy,
} from '../../domain/document-upload-policy';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';

/** Plafond par exécution : borne la durée du job (le suivant reprendra la suite). */
export const PURGE_BATCH_SIZE = 500;

export interface PurgeReport {
  readonly purged: number;
  /** Clés dont la ligne est supprimée mais pas le fichier (à reprendre à la main). */
  readonly orphanKeys: readonly string[];
}

/**
 * Purge des imports jamais confirmés (> 24 h) : la ligne puis le fichier.
 *
 * Ordre volontaire : la suppression de la ligne est **conditionnelle**
 * (`awaiting_upload` seulement). Si une confirmation tardive a gagné la
 * course, la ligne reste et le fichier — devenu un vrai document — est
 * conservé. L'inverse (fichier d'abord) pourrait détruire un document
 * confirmé à la dernière seconde.
 *
 * Une panne du stockage n'arrête pas la purge : la clé est remontée dans le
 * rapport pour être loggée par le job appelant.
 */
@Injectable()
export class PurgeAbandonedUploadsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(DOCUMENT_UPLOAD_POLICY) private readonly policy: DocumentUploadPolicy,
  ) {}

  async execute(): Promise<PurgeReport> {
    const cutoff = new Date(
      this.clock.now().getTime() - this.policy.abandonedUploadTtlSeconds * 1000,
    );
    const abandoned = await this.documents.findAbandonedUploads(cutoff, PURGE_BATCH_SIZE);

    let purged = 0;
    const orphanKeys: string[] = [];
    for (const upload of abandoned) {
      if (!(await this.documents.deleteIfAwaitingUpload(upload.id))) continue;
      purged += 1;
      try {
        await this.storage.delete(upload.sourceKey);
      } catch {
        // Pas silencieux : la clé remonte dans le rapport, loggé par le job.
        orphanKeys.push(upload.sourceKey);
      }
    }
    return { purged, orphanKeys };
  }
}
