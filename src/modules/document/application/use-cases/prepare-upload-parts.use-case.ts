import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignedUpload,
} from '@/shared/storage/object-storage.port';

import {
  DOCUMENT_UPLOAD_POLICY,
  type DocumentUploadPolicy,
} from '../../domain/document-upload-policy';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { DocumentUploadConflictError } from '../../domain/errors/document-upload-conflict.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { missingParts, planParts } from '../../domain/services/multipart';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

export interface PrepareUploadPartsInput {
  readonly ownerId: OwnerId;
  readonly documentId: DocumentId;
}

export interface UploadPartInstruction extends PresignedUpload {
  readonly partNumber: number;
}

export interface UploadPartsTicket {
  /** Morceaux déjà reçus à la bonne taille : rien à renvoyer. */
  readonly receivedParts: readonly number[];
  /** Une URL par morceau manquant. */
  readonly parts: readonly UploadPartInstruction[];
  readonly expiresAt: Date;
}

/**
 * `POST /v1/documents/:id/upload-parts` (ADR-0029) : démarre ou reprend un
 * envoi par morceaux. Les morceaux reçus sont lus **chez le fournisseur**
 * (jamais déclarés par le client) ; chaque morceau manquant reçoit une URL
 * `PUT` signée avec sa taille exacte. Après une coupure, le mobile rappelle
 * la route et n'envoie que le reste.
 *
 * Lecture seule côté base : rejouable à volonté.
 */
@Injectable()
export class PrepareUploadPartsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(DOCUMENT_UPLOAD_POLICY) private readonly policy: DocumentUploadPolicy,
  ) {}

  async execute(input: PrepareUploadPartsInput): Promise<Result<UploadPartsTicket, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status !== DocumentStatus.AWAITING_UPLOAD) {
      return Result.err(new DocumentUploadConflictError(document.id));
    }
    const uploadId = await this.documents.findUploadId(document.id);
    if (uploadId === null) return Result.err(new DocumentUploadConflictError(document.id));

    const received = await this.storage.listUploadedParts(document.sourceKey, uploadId);
    // Envoi déjà assemblé ou annulé : il ne reste qu'à confirmer (ou à
    // recommencer l'import).
    if (received === null) return Result.err(new DocumentUploadConflictError(document.id));

    const plan = planParts(document.sizeBytes);
    const missing = missingParts(plan, received);
    const parts = await Promise.all(
      missing.map(async (part) => ({
        partNumber: part.partNumber,
        ...(await this.storage.presignUploadPart({
          key: document.sourceKey,
          uploadId,
          partNumber: part.partNumber,
          contentLength: part.sizeBytes,
          expiresInSeconds: this.policy.uploadUrlTtlSeconds,
        })),
      })),
    );
    const missingNumbers = new Set(missing.map((part) => part.partNumber));
    const now = this.clock.now();
    return Result.ok({
      receivedParts: plan
        .map((part) => part.partNumber)
        .filter((number) => !missingNumbers.has(number)),
      parts,
      expiresAt: new Date(now.getTime() + this.policy.uploadUrlTtlSeconds * 1000),
    });
  }
}
