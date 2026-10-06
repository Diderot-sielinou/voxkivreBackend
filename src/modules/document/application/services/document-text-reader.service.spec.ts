import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { DocumentTextReader, PAGE_READ_BATCH } from './document-text-reader.service';

const NOW = new Date('2026-10-06T10:00:00Z');
const ID = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

async function seed(repo: InMemoryDocumentRepository, pageCount: number) {
  const doc = markUploaded(
    newDocumentAwaitingUpload({
      id: DocumentId.of(ID),
      ownerId: OwnerId.of('alice'),
      title: 'x' as DocumentTitle,
      sizeBytes: 1 as DocumentSize,
      now: NOW,
    }),
    NOW,
  );
  await repo.insert({ ...doc, status: DocumentStatus.EXTRACTING });
  await repo.completeExtraction(
    doc.id,
    Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      text: `p${String(i + 1)}`,
      charCount: 2,
    })),
    pageCount * 2,
    NOW,
  );
}

describe('DocumentTextReader', () => {
  it('exposes the text state, filtered by owner', async () => {
    const repo = new InMemoryDocumentRepository();
    await seed(repo, 2);
    const reader = new DocumentTextReader(repo);
    expect(await reader.findForOwner(ID, 'alice')).toEqual({
      documentId: ID,
      ownerId: 'alice',
      status: 'text_ready',
      charCount: 4,
      textRevision: 1,
    });
    expect(await reader.findForOwner(ID, 'bob')).toBeNull();
    expect(await reader.findById(ID)).toMatchObject({ ownerId: 'alice' });
    expect(await reader.findById('01a11019-f2e7-7014-8369-000000000000')).toBeNull();
  });

  it('reads every page in order, across several batches', async () => {
    const repo = new InMemoryDocumentRepository();
    await seed(repo, PAGE_READ_BATCH + 3);
    const pages = await new DocumentTextReader(repo).readPages(ID);
    expect(pages).toHaveLength(PAGE_READ_BATCH + 3);
    expect(pages.at(0)).toEqual({ pageNumber: 1, text: 'p1' });
    expect(pages.at(-1)?.pageNumber).toBe(PAGE_READ_BATCH + 3);
  });

  it('bumps the revision on every page correction', async () => {
    const repo = new InMemoryDocumentRepository();
    await seed(repo, 1);
    await repo.updatePageText(DocumentId.of(ID), 1, 'corrigé', 7, NOW);
    expect(await new DocumentTextReader(repo).findById(ID)).toMatchObject({ textRevision: 2 });
  });
});
