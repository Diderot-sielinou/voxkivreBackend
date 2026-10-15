import { FixedClock, InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { type Document, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { RenameDocumentUseCase } from './rename-document.use-case';

const T1 = new Date('2026-10-15T10:00:00Z');
const T2 = new Date('2026-10-15T11:00:00Z');

describe('RenameDocumentUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let doc: Document;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    doc = newDocumentAwaitingUpload({
      id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c'),
      ownerId: OwnerId.of('user-1'),
      title: 'cours_droit_L2_v3_FINAL.pdf' as DocumentTitle,
      sizeBytes: 10 as DocumentSize,
      now: T1,
    });
    await repo.insert(doc);
  });

  it('renames with the import rules (trimmed, spaces collapsed)', async () => {
    const result = await new RenameDocumentUseCase(repo, new FixedClock(T2)).execute({
      ownerId: doc.ownerId,
      documentId: doc.id,
      title: '  Droit des   obligations — L2 ',
    });

    expect(result.value.title).toBe('Droit des obligations — L2');
    expect(result.value.updatedAt).toEqual(T2);
    expect(repo.rows.get(doc.id)?.title).toBe('Droit des obligations — L2');
  });

  it('refuses an empty or too long title, and another owner', async () => {
    const useCase = new RenameDocumentUseCase(repo, new FixedClock(T2));

    const empty = await useCase.execute({ ownerId: doc.ownerId, documentId: doc.id, title: '  ' });
    expect(empty.error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_TITLE);

    const long = await useCase.execute({
      ownerId: doc.ownerId,
      documentId: doc.id,
      title: 'x'.repeat(201),
    });
    expect(long.error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_TITLE);

    const other = await useCase.execute({
      ownerId: OwnerId.of('u2'),
      documentId: doc.id,
      title: 'Volé',
    });
    expect(other.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
    expect(repo.rows.get(doc.id)?.title).toBe('cours_droit_L2_v3_FINAL.pdf');
  });
});
