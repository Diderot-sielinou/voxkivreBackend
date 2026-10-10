import { Injectable } from '@nestjs/common';

import {
  DocumentCatalog,
  type DocumentOverview,
} from '@/modules/document/application/services/document-catalog.service';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';

import {
  type DeletedLibraryDocument,
  type LibraryCursorPosition,
  type LibraryDocument,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';
import { DocumentState } from '../../domain/value-objects/library-item-status.vo';

function stateOf(status: DocumentStatus): DocumentState {
  if (status === DocumentStatus.TEXT_READY) return DocumentState.TEXT_READY;
  if (status === DocumentStatus.EXTRACTION_FAILED) return DocumentState.FAILED;
  return DocumentState.PROCESSING; // uploaded, extracting (awaiting_upload n'est jamais listé)
}

function toLibraryDocument(overview: DocumentOverview): LibraryDocument {
  return {
    documentId: overview.documentId,
    title: overview.title,
    status: overview.status,
    state: stateOf(overview.status),
    pageCount: overview.pageCount,
    charCount: overview.charCount,
    extractionError: overview.extractionError,
    createdAt: overview.createdAt,
  };
}

/**
 * Port `LibraryDocuments` branché sur le service exporté par
 * `DocumentModule` (jamais sur son repository, dependency-injection.md).
 */
@Injectable()
export class DocumentModuleLibraryDocuments implements LibraryDocumentsPort {
  constructor(private readonly catalog: DocumentCatalog) {}

  async listForOwner(
    ownerId: string,
    after: LibraryCursorPosition | null,
    limit: number,
  ): Promise<readonly LibraryDocument[]> {
    const rows = await this.catalog.listForOwner(ownerId, after, limit);
    return rows.map((row) => toLibraryDocument(row));
  }

  async findForOwner(documentId: string, ownerId: string): Promise<LibraryDocument | null> {
    const overview = await this.catalog.findForOwner(documentId, ownerId);
    return overview === null ? null : toLibraryDocument(overview);
  }

  deleteForOwner(
    documentId: string,
    ownerId: string,
    tx: unknown,
  ): Promise<DeletedLibraryDocument | null> {
    return this.catalog.deleteForOwner(documentId, ownerId, tx);
  }
}
