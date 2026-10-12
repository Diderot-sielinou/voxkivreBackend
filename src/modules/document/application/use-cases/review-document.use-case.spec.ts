import { FixedClock, InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import {
  type Document,
  isReviewPending,
  markUploaded,
  newDocumentAwaitingUpload,
} from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { ReviewDocumentUseCase } from './review-document.use-case';

const T1 = new Date('2026-10-12T10:00:00Z');
const T2 = new Date('2026-10-12T11:00:00Z');

describe('ReviewDocumentUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let doc: Document;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    doc = {
      ...markUploaded(
        newDocumentAwaitingUpload({
          id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
          ownerId: OwnerId.of('user-1'),
          title: 'Scan' as DocumentTitle,
          sizeBytes: 10 as DocumentSize,
          now: T1,
        }),
        T1,
      ),
      status: DocumentStatus.TEXT_READY,
      reviewRequired: true,
    };
    await repo.insert(doc);
  });

  it('records the first review only, and unblocks the conversion', async () => {
    expect(isReviewPending(doc)).toBe(true);

    const first = await new ReviewDocumentUseCase(repo, new FixedClock(T1)).execute({
      ownerId: doc.ownerId,
      documentId: doc.id,
    });
    const again = await new ReviewDocumentUseCase(repo, new FixedClock(T2)).execute({
      ownerId: doc.ownerId,
      documentId: doc.id,
    });

    expect(first.value.reviewedAt).toEqual(T1);
    expect(again.value.reviewedAt).toEqual(T1);
    expect(isReviewPending(again.value)).toBe(false);
  });

  it('answers not found for another owner, and 409 before the text is ready', async () => {
    const useCase = new ReviewDocumentUseCase(repo, new FixedClock(T1));
    const other = await useCase.execute({ ownerId: OwnerId.of('u2'), documentId: doc.id });
    expect(other.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);

    repo.rows.set(doc.id, { ...doc, status: DocumentStatus.EXTRACTING });
    const early = await useCase.execute({ ownerId: doc.ownerId, documentId: doc.id });
    expect(early.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_TEXT_NOT_READY);
  });
});
