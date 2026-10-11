import { FixedClock, InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { UpdateDocumentPageUseCase } from './update-document-page.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');
const LATER = new Date('2026-10-06T11:00:00Z');
const OWNER = OwnerId.of('user-1');
const ID = DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b');

describe('UpdateDocumentPageUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let useCase: UpdateDocumentPageUseCase;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    useCase = new UpdateDocumentPageUseCase(repo, new FixedClock(LATER));
    const doc = markUploaded(
      newDocumentAwaitingUpload({
        id: ID,
        ownerId: OWNER,
        title: 'x' as DocumentTitle,
        sizeBytes: 1 as DocumentSize,
        now: NOW,
      }),
      NOW,
    );
    await repo.insert({ ...doc, status: DocumentStatus.EXTRACTING });
    await repo.completeExtraction(
      ID,
      [
        { pageNumber: 1, text: 'aaaa', charCount: 4, setAside: [] },
        { pageNumber: 2, text: 'bbbbbb', charCount: 6, setAside: [] },
      ],
      10,
      NOW,
    );
  });

  const update = (pageNumber: number, text: string, ownerId = OWNER) =>
    useCase.execute({ ownerId, documentId: ID, pageNumber, text });

  it('replaces the page text and recomputes the document character count', async () => {
    const r = await update(2, ' corrigé\r\nici ');
    expect(r.value).toMatchObject({
      pageNumber: 2,
      text: 'corrigé\nici',
      charCount: 10,
      updatedAt: LATER,
    });
    expect(repo.rows.get(ID)?.charCount).toBe(14);
  });

  it.each([
    ['unknown page', () => update(9, 'x'), DOCUMENT_ERROR_CODES.DOCUMENT_PAGE_NOT_FOUND],
    [
      'another owner',
      () => update(1, 'x', OwnerId.of('intruder')),
      DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND,
    ],
    ['invalid text', () => update(1, 'bip\u0007'), DOCUMENT_ERROR_CODES.INVALID_PAGE_TEXT],
  ])('rejects %s', async (_label, run, code) => {
    const result = await run();
    expect(result.error.code).toBe(code);
    expect(repo.rows.get(ID)?.charCount).toBe(10);
  });

  it('refuses edits while the text is not ready (409)', async () => {
    const doc = repo.rows.get(ID);
    if (doc !== undefined) repo.rows.set(ID, { ...doc, status: DocumentStatus.EXTRACTION_FAILED });
    const result = await update(1, 'x');
    expect(result.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_TEXT_NOT_READY);
  });
});
