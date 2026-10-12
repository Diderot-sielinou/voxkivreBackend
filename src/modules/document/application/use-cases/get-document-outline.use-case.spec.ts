import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { GetDocumentOutlineUseCase } from './get-document-outline.use-case';

const NOW = new Date('2026-10-12T10:00:00Z');

describe('GetDocumentOutlineUseCase', () => {
  const base = markUploaded(
    newDocumentAwaitingUpload({
      id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
      ownerId: OwnerId.of('user-1'),
      title: 'Cours' as DocumentTitle,
      sizeBytes: 10 as DocumentSize,
      now: NOW,
    }),
    NOW,
  );

  async function useCaseWith(document: typeof base) {
    const repo = new InMemoryDocumentRepository();
    await repo.insert(document);
    return new GetDocumentOutlineUseCase(repo);
  }

  it('returns the outline stored at extraction', async () => {
    const outline = {
      source: 'headings' as const,
      entries: [{ title: 'Chapitre 1', level: 1, pageNumber: 1 }],
    };
    const useCase = await useCaseWith({ ...base, status: DocumentStatus.TEXT_READY, outline });

    const result = await useCase.execute({ ownerId: base.ownerId, documentId: base.id });
    expect(result.value).toEqual(outline);
  });

  it('returns an empty list for a document extracted before the outline existed', async () => {
    const useCase = await useCaseWith({ ...base, status: DocumentStatus.TEXT_READY });

    const result = await useCase.execute({ ownerId: base.ownerId, documentId: base.id });
    expect(result.value).toEqual({ source: null, entries: [] });
  });

  it('answers 404 for another owner and 409 before the text is ready', async () => {
    const useCase = await useCaseWith(base);
    const other = await useCase.execute({ ownerId: OwnerId.of('u2'), documentId: base.id });
    const early = await useCase.execute({ ownerId: base.ownerId, documentId: base.id });

    expect(other.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
    expect(early.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_TEXT_NOT_READY);
  });
});
