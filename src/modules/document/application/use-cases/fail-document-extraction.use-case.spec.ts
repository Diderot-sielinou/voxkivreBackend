import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { FailDocumentExtractionUseCase } from './fail-document-extraction.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');

describe('FailDocumentExtractionUseCase', () => {
  const doc = markUploaded(
    newDocumentAwaitingUpload({
      id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
      ownerId: OwnerId.of('user-1'),
      title: 'x' as DocumentTitle,
      sizeBytes: 1 as DocumentSize,
      now: NOW,
    }),
    NOW,
  );

  it('marks the document failed (internal) and deletes the PDF, never leaving it stuck', async () => {
    const repo = new InMemoryDocumentRepository();
    const storage = new FakeObjectStorage();
    await repo.insert({ ...doc, status: DocumentStatus.EXTRACTING });
    storage.seed(doc.sourceKey, '%PDF-');

    await new FailDocumentExtractionUseCase(repo, storage, new FixedClock(NOW)).execute(doc.id);

    expect(repo.rows.get(doc.id)).toMatchObject({
      status: DocumentStatus.EXTRACTION_FAILED,
      extractionError: 'internal',
      sourceDeletedAt: NOW,
    });
    expect(storage.objects.size).toBe(0);
  });

  it('leaves a settled document untouched', async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.insert({ ...doc, status: DocumentStatus.TEXT_READY });
    await new FailDocumentExtractionUseCase(
      repo,
      new FakeObjectStorage(),
      new FixedClock(NOW),
    ).execute(doc.id);
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.TEXT_READY);
  });
});
