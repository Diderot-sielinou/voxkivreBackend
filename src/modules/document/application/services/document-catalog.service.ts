import { Inject, Injectable } from '@nestjs/common';

import { type Document } from '../../domain/entities/document.entity';
import {
  type DeletedDocument,
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import {
  type DocumentStatus,
  type ExtractionFailureReason,
} from '../../domain/value-objects/document-status.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

/** Ce qu'un autre module peut savoir d'un document importé (jamais l'entité). */
export interface DocumentOverview {
  readonly documentId: string;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly pageCount: number | null;
  readonly charCount: number | null;
  readonly extractionError: ExtractionFailureReason | null;
  readonly createdAt: Date;
}

/** Position de pagination : tri `(createdAt DESC, id DESC)`. */
export interface DocumentCursorPosition {
  readonly createdAt: Date;
  readonly documentId: string;
}

function toOverview(document: Document): DocumentOverview {
  return {
    documentId: document.id,
    title: document.title,
    status: document.status,
    pageCount: document.pageCount,
    charCount: document.charCount,
    extractionError: document.extractionError,
    createdAt: document.createdAt,
  };
}

/**
 * Documents **pour les autres modules** (la bibliothèque, ADR-0015 et
 * ADR-0016) : exporté par `DocumentModule`, consommé derrière un port du
 * module appelant. Identifiants en `string`.
 */
@Injectable()
export class DocumentCatalog {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort) {}

  /** Documents importés du propriétaire, du plus récent au plus ancien, après `after`. */
  async listForOwner(
    ownerId: string,
    after: DocumentCursorPosition | null,
    limit: number,
  ): Promise<readonly DocumentOverview[]> {
    const rows = await this.documents.listImportedByOwner(
      OwnerId.of(ownerId),
      after === null ? null : { createdAt: after.createdAt, id: DocumentId.of(after.documentId) },
      limit,
    );
    return rows.map((d) => toOverview(d));
  }

  /** Filtré par propriétaire : `null` si absent ou à quelqu'un d'autre (RNF-08). */
  async findForOwner(documentId: string, ownerId: string): Promise<DocumentOverview | null> {
    const document = await this.documents.findByIdForOwner(
      DocumentId.of(documentId),
      OwnerId.of(ownerId),
    );
    return document === null ? null : toOverview(document);
  }

  /** Supprime le document du propriétaire dans la transaction ambiante ; `null` si absent. */
  deleteForOwner(
    documentId: string,
    ownerId: string,
    tx?: unknown,
  ): Promise<DeletedDocument | null> {
    return this.documents.deleteForOwner(DocumentId.of(documentId), OwnerId.of(ownerId), tx);
  }
}
