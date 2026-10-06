import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import {
  type Document,
  hasPdfSignature,
  markUploaded,
  PDF_SIGNATURE,
} from '../../domain/entities/document.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { InvalidDocumentUploadError } from '../../domain/errors/invalid-document-upload.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import {
  EXTRACTION_SCHEDULER,
  type ExtractionSchedulerPort,
} from '../../domain/ports/extraction-scheduler.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

export interface ConfirmDocumentUploadInput {
  readonly ownerId: OwnerId;
  readonly documentId: DocumentId;
}

/**
 * `POST /v1/documents/:id/upload-confirmation` : le mobile signale la fin de
 * l'upload direct ; on vérifie le fichier **réellement reçu** avant de
 * l'accepter (jamais l'extension ni le type MIME déclarés par le client).
 *
 * Idempotent : sur un réseau instable le mobile peut rejouer la
 * confirmation sans savoir si la première est passée — un document déjà
 * `uploaded` est renvoyé tel quel, sans relire le stockage.
 *
 * Fichier accepté : l'extraction du texte est programmée (ADR-0009).
 *
 * Fichier invalide (mauvaise taille, pas un PDF) : il est supprimé et le
 * document reste `awaiting_upload` (purgé après 24 h). Fichier absent : on ne
 * supprime rien, l'upload est peut-être encore en cours.
 */
@Injectable()
export class ConfirmDocumentUploadUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(EXTRACTION_SCHEDULER) private readonly extraction: ExtractionSchedulerPort,
  ) {}

  async execute(input: ConfirmDocumentUploadInput): Promise<Result<Document, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status === DocumentStatus.UPLOADED) return Result.ok(document);

    const object = await this.storage.head(document.sourceKey);
    if (object === null) {
      return Result.err(new InvalidDocumentUploadError(document.id, 'missing'));
    }
    if (object.sizeBytes !== document.sizeBytes) {
      await this.storage.delete(document.sourceKey);
      return Result.err(new InvalidDocumentUploadError(document.id, 'size_mismatch'));
    }

    const firstBytes = await this.storage.readRange(
      document.sourceKey,
      0,
      PDF_SIGNATURE.length - 1,
    );
    if (!hasPdfSignature(firstBytes)) {
      await this.storage.delete(document.sourceKey);
      return Result.err(new InvalidDocumentUploadError(document.id, 'not_pdf'));
    }

    const uploaded = markUploaded(document, this.clock.now());
    await this.documents.markUploaded(document.id, uploaded.updatedAt);
    // Ne lève jamais : si la file est indisponible, le balayage reprogrammera.
    await this.extraction.schedule(document.id);
    return Result.ok(uploaded);
  }
}
