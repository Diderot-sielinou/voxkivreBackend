import { Inject, Injectable } from '@nestjs/common';

import { type Document } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

/** Pages lues par paquets : un livre de 2 000 pages ne tient pas dans une seule requête. */
export const PAGE_READ_BATCH = 500;

/** Ce qu'un autre module peut savoir du texte d'un document (jamais l'entité). */
export interface DocumentTextState {
  readonly documentId: string;
  readonly ownerId: string;
  readonly status: DocumentStatus;
  /** `null` tant que le texte n'est pas extrait. */
  readonly charCount: number | null;
  readonly textRevision: number;
}

export interface DocumentPageText {
  readonly pageNumber: number;
  readonly text: string;
}

function toState(document: Document): DocumentTextState {
  return {
    documentId: document.id,
    ownerId: document.ownerId,
    status: document.status,
    charCount: document.charCount,
    textRevision: document.textRevision,
  };
}

/**
 * Lecture du texte d'un document **pour les autres modules** (la conversion,
 * ADR-0010) : exporté par `DocumentModule`, consommé derrière un port du
 * module appelant. Lecture seule ; les identifiants sont des `string` pour
 * que l'appelant ne dépende pas des types du domaine `document`.
 */
@Injectable()
export class DocumentTextReader {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort) {}

  /** Filtré par propriétaire : `null` si absent ou à quelqu'un d'autre (RNF-08). */
  async findForOwner(documentId: string, ownerId: string): Promise<DocumentTextState | null> {
    const document = await this.documents.findByIdForOwner(
      DocumentId.of(documentId),
      OwnerId.of(ownerId),
    );
    return document === null ? null : toState(document);
  }

  /** Sans filtre propriétaire : réservé aux workers. */
  async findById(documentId: string): Promise<DocumentTextState | null> {
    const document = await this.documents.findById(DocumentId.of(documentId));
    return document === null ? null : toState(document);
  }

  /** Toutes les pages, dans l'ordre. */
  async readPages(documentId: string): Promise<readonly DocumentPageText[]> {
    const id = DocumentId.of(documentId);
    const pages: DocumentPageText[] = [];
    let after = 0;
    for (;;) {
      const batch = await this.documents.listPages(id, after, PAGE_READ_BATCH);
      for (const page of batch) pages.push({ pageNumber: page.pageNumber, text: page.text });
      const last = batch.at(-1);
      if (last === undefined || batch.length < PAGE_READ_BATCH) return pages;
      after = last.pageNumber;
    }
  }
}
