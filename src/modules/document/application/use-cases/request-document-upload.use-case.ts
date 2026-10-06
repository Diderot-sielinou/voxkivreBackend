import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result, uuidV7 } from '@/shared/kernel';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignedUpload,
} from '@/shared/storage/object-storage.port';

import {
  DOCUMENT_UPLOAD_POLICY,
  type DocumentUploadPolicy,
} from '../../domain/document-upload-policy';
import {
  type Document,
  newDocumentAwaitingUpload,
  PDF_CONTENT_TYPE,
} from '../../domain/entities/document.entity';
import { InvalidRightsAttestationError } from '../../domain/errors/invalid-rights-attestation.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

export interface RequestDocumentUploadInput {
  readonly ownerId: OwnerId;
  readonly title: string;
  readonly sizeBytes: number;
  readonly rightsAttested: boolean;
}

export interface DocumentUploadTicket {
  readonly document: Document;
  readonly upload: PresignedUpload & { readonly expiresAt: Date };
}

/**
 * `POST /v1/documents` (RF-01, RNF-24) : enregistre l'intention d'import et
 * renvoie une URL d'upload **direct** vers le stockage objet. Les octets du
 * PDF ne transitent jamais par l'API (bande passante Railway, timeouts sur
 * réseau instable — ADR-0007).
 *
 * Pas d'`Idempotency-Key` : un doublon ne coûte ni TTS ni quota, et la purge
 * des uploads abandonnés le supprime.
 */
@Injectable()
export class RequestDocumentUploadUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(DOCUMENT_UPLOAD_POLICY) private readonly policy: DocumentUploadPolicy,
  ) {}

  async execute(
    input: RequestDocumentUploadInput,
  ): Promise<Result<DocumentUploadTicket, DomainError>> {
    if (!input.rightsAttested) return Result.err(new InvalidRightsAttestationError());

    const title = DocumentTitle.of(input.title);
    if (title.isErr()) return Result.err(title.error);

    const size = DocumentSize.of(input.sizeBytes, this.policy.maxSizeBytes);
    if (size.isErr()) return Result.err(size.error);

    const now = this.clock.now();
    const document = newDocumentAwaitingUpload({
      id: DocumentId.of(uuidV7()),
      ownerId: input.ownerId,
      title: title.value,
      sizeBytes: size.value,
      now,
    });

    // Signature avant insertion : si le stockage n'est pas configuré (503),
    // aucune ligne orpheline n'est créée.
    const upload = await this.storage.presignPut({
      key: document.sourceKey,
      contentType: PDF_CONTENT_TYPE,
      contentLength: document.sizeBytes,
      expiresInSeconds: this.policy.uploadUrlTtlSeconds,
    });
    await this.documents.insert(document);

    const expiresAt = new Date(now.getTime() + this.policy.uploadUrlTtlSeconds * 1000);
    return Result.ok({ document, upload: { ...upload, expiresAt } });
  }
}
