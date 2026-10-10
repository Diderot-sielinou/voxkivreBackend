import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { type Document } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';

import { DocumentCatalog } from './document-catalog.service';

const AT = new Date('2026-10-10T10:00:00Z');

function document(
  id: string,
  ownerId: string,
  minutes: number,
  status: DocumentStatus = DocumentStatus.TEXT_READY,
): Document {
  const at = new Date(AT.getTime() + minutes * 60_000);
  return {
    id: DocumentId.of(id),
    ownerId: ownerId as never,
    title: `Livre ${id}` as never,
    status,
    sizeBytes: 10 as never,
    sourceKey: `documents/${ownerId}/${id}/source.pdf`,
    rightsAttestedAt: at,
    rightsAttestationVersion: 'v1',
    uploadedAt: at,
    pageCount: 2,
    charCount: 100,
    textRevision: 1,
    extractionError: null,
    sourceDeletedAt: status === DocumentStatus.TEXT_READY ? at : null,
    createdAt: at,
    updatedAt: at,
  };
}

describe('DocumentCatalog', () => {
  let repo: InMemoryDocumentRepository;
  let catalog: DocumentCatalog;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    catalog = new DocumentCatalog(repo);
    await repo.insert(document('d1', 'alice', 0));
    await repo.insert(document('d2', 'alice', 1, DocumentStatus.UPLOADED));
    await repo.insert(document('d3', 'alice', 2, DocumentStatus.AWAITING_UPLOAD));
    await repo.insert(document('x', 'bob', 3));
  });

  it("lists the owner's imported documents, newest first, after a position", async () => {
    const all = await catalog.listForOwner('alice', null, 10);
    expect(all.map((d) => d.documentId)).toEqual(['d2', 'd1']);
    const after = { createdAt: new Date(AT.getTime() + 60_000), documentId: 'd2' };
    const rest = await catalog.listForOwner('alice', after, 10);
    expect(rest.map((d) => d.documentId)).toEqual(['d1']);
  });

  it('finds and deletes for the owner only, reporting the source PDF state', async () => {
    expect(await catalog.findForOwner('x', 'alice')).toBeNull();
    expect(await catalog.deleteForOwner('x', 'alice')).toBeNull();
    expect(await catalog.deleteForOwner('d2', 'alice')).toEqual({
      sourceKey: 'documents/alice/d2/source.pdf',
      sourceDeleted: false,
    });
    expect(await catalog.findForOwner('d2', 'alice')).toBeNull();
  });
});
