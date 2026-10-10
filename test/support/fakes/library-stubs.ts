import {
  type DocumentConversionsCleanup,
  type LibraryConversion,
  type LibraryConversionsPort,
} from '@/modules/library/domain/ports/library-conversions.port';
import {
  type DeletedLibraryDocument,
  type LibraryCursorPosition,
  type LibraryDocument,
  type LibraryDocumentsPort,
} from '@/modules/library/domain/ports/library-documents.port';
import {
  ConversionState,
  DocumentState,
} from '@/modules/library/domain/value-objects/library-item-status.vo';

export const OWNER = 'alice';
export const AT = new Date('2026-10-10T10:00:00Z');

export function libraryDocument(
  documentId: string,
  minutes: number,
  overrides: Partial<LibraryDocument> = {},
): LibraryDocument {
  return {
    documentId,
    title: `Livre ${documentId}`,
    status: 'text_ready',
    state: DocumentState.TEXT_READY,
    pageCount: 3,
    charCount: 5000,
    extractionError: null,
    createdAt: new Date(AT.getTime() + minutes * 60_000),
    ...overrides,
  };
}

export function libraryConversion(
  conversionId: string,
  documentId: string,
  overrides: Partial<LibraryConversion> = {},
): LibraryConversion {
  return {
    conversionId,
    documentId,
    voiceId: 'fr-f1',
    status: 'ready',
    state: ConversionState.READY,
    failureReason: null,
    partCount: 2,
    partsReady: 2,
    playableWordCount: 1000,
    playableDurationMs: 600_000,
    completedAt: AT,
    ...overrides,
  };
}

/** Documents en mémoire, triés comme l'adapter réel (`createdAt DESC, id DESC`). */
export class StubLibraryDocuments implements LibraryDocumentsPort {
  readonly rows = new Map<
    string,
    LibraryDocument & { ownerId: string; sourceKey: string; sourceDeleted: boolean }
  >();
  readonly deleteTx: unknown[] = [];

  add(document: LibraryDocument, ownerId = OWNER, sourceDeleted = true): void {
    this.rows.set(document.documentId, {
      ...document,
      ownerId,
      sourceKey: `documents/${ownerId}/${document.documentId}/source.pdf`,
      sourceDeleted,
    });
  }

  listForOwner(
    ownerId: string,
    after: LibraryCursorPosition | null,
    limit: number,
  ): Promise<readonly LibraryDocument[]> {
    const isAfter = (d: LibraryDocument) =>
      after === null ||
      d.createdAt.getTime() < after.createdAt.getTime() ||
      (d.createdAt.getTime() === after.createdAt.getTime() && d.documentId < after.documentId);
    return Promise.resolve(
      [...this.rows.values()]
        .filter((d) => d.ownerId === ownerId && isAfter(d))
        .toSorted(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.documentId.localeCompare(a.documentId),
        )
        .slice(0, limit),
    );
  }

  findForOwner(documentId: string, ownerId: string): Promise<LibraryDocument | null> {
    const found = this.rows.get(documentId);
    return Promise.resolve(found?.ownerId === ownerId ? found : null);
  }

  deleteForOwner(
    documentId: string,
    ownerId: string,
    tx: unknown,
  ): Promise<DeletedLibraryDocument | null> {
    this.deleteTx.push(tx);
    const found = this.rows.get(documentId);
    if (found?.ownerId !== ownerId) return Promise.resolve(null);
    this.rows.delete(documentId);
    return Promise.resolve({ sourceKey: found.sourceKey, sourceDeleted: found.sourceDeleted });
  }
}

export class StubLibraryConversions implements LibraryConversionsPort {
  readonly byDocument = new Map<string, LibraryConversion>();
  readonly owners = new Map<string, string>();
  cleanup: DocumentConversionsCleanup = { running: false, fileKeys: [] };
  readonly requestedDocumentIds: (readonly string[])[] = [];

  add(conversion: LibraryConversion, ownerId = OWNER): void {
    this.byDocument.set(conversion.documentId, conversion);
    this.owners.set(conversion.conversionId, ownerId);
  }

  forDocuments(
    ownerId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, LibraryConversion>> {
    this.requestedDocumentIds.push(documentIds);
    return Promise.resolve(
      new Map(
        documentIds
          .map((id) => this.byDocument.get(id))
          .filter(
            (c): c is LibraryConversion =>
              c !== undefined && this.owners.get(c.conversionId) === ownerId,
          )
          .map((c) => [c.documentId, c] as const),
      ),
    );
  }

  findForOwner(conversionId: string, ownerId: string): Promise<LibraryConversion | null> {
    const found = [...this.byDocument.values()].find((c) => c.conversionId === conversionId);
    return Promise.resolve(
      found !== undefined && this.owners.get(conversionId) === ownerId ? found : null,
    );
  }

  cleanupForDocument(): Promise<DocumentConversionsCleanup> {
    return Promise.resolve(this.cleanup);
  }
}
