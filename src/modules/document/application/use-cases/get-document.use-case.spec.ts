import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { GetDocumentUseCase } from './get-document.use-case';

describe('GetDocumentUseCase', () => {
  const doc = newDocumentAwaitingUpload({
    id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
    ownerId: OwnerId.of('user-1'),
    title: 'Titre' as DocumentTitle,
    sizeBytes: 10 as DocumentSize,
    now: new Date('2026-10-06T10:00:00Z'),
  });

  it('returns the owner’s document whatever its status', async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.insert(doc);
    const r = await new GetDocumentUseCase(repo).execute({
      ownerId: doc.ownerId,
      documentId: doc.id,
    });
    expect(r.value).toEqual(doc);
  });

  it('returns DOCUMENT_NOT_FOUND for an unknown id or another owner', async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.insert(doc);
    const useCase = new GetDocumentUseCase(repo);
    const other = await useCase.execute({ ownerId: OwnerId.of('u2'), documentId: doc.id });
    const unknown = await useCase.execute({
      ownerId: doc.ownerId,
      documentId: DocumentId.of('01a11019-f2e7-7014-8369-000000000000'),
    });
    expect(other.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
    expect(unknown.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
  });
});
