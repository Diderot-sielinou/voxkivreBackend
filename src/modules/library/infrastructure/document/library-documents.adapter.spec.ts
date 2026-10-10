import { DocumentCatalog } from '@/modules/document/application/services/document-catalog.service';
import { type Document } from '@/modules/document/domain/entities/document.entity';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';

import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { DocumentState } from '../../domain/value-objects/library-item-status.vo';

import { DocumentModuleLibraryDocuments } from './library-documents.adapter';

const AT = new Date('2026-10-10T10:00:00Z');

function document(id: string, minutes: number, status: DocumentStatus): Document {
  const at = new Date(AT.getTime() + minutes * 60_000);
  return {
    id: DocumentId.of(id),
    ownerId: 'alice' as never,
    title: 'Livre' as never,
    status,
    sizeBytes: 10 as never,
    sourceKey: `documents/alice/${id}/source.pdf`,
    rightsAttestedAt: at,
    rightsAttestationVersion: 'v1',
    uploadedAt: at,
    pageCount: null,
    charCount: null,
    textRevision: 0,
    extractionError: null,
    sourceDeletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe('DocumentModuleLibraryDocuments', () => {
  it('translates document statuses into library states, and deletes for the owner', async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.insert(document('uploaded', 0, DocumentStatus.UPLOADED));
    await repo.insert(document('extracting', 1, DocumentStatus.EXTRACTING));
    await repo.insert(document('ready', 2, DocumentStatus.TEXT_READY));
    await repo.insert(document('failed', 3, DocumentStatus.EXTRACTION_FAILED));
    const adapter = new DocumentModuleLibraryDocuments(new DocumentCatalog(repo));

    const page = await adapter.listForOwner('alice', null, 10);
    expect(page.map((d) => [d.documentId, d.status, d.state])).toEqual([
      ['failed', 'extraction_failed', DocumentState.FAILED],
      ['ready', 'text_ready', DocumentState.TEXT_READY],
      ['extracting', 'extracting', DocumentState.PROCESSING],
      ['uploaded', 'uploaded', DocumentState.PROCESSING],
    ]);
    const found = await adapter.findForOwner('ready', 'alice');
    expect(found?.state).toBe(DocumentState.TEXT_READY);
    expect(await adapter.findForOwner('ready', 'bob')).toBeNull();
    expect(await adapter.deleteForOwner('ready', 'alice', null)).toEqual({
      sourceKey: 'documents/alice/ready/source.pdf',
      sourceDeleted: false,
    });
  });
});
