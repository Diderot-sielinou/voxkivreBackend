import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { type DocumentUploadPolicy } from '../../domain/document-upload-policy';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { PrepareUploadPartsUseCase } from './prepare-upload-parts.use-case';

const MIB = 1024 * 1024;
const NOW = new Date('2026-10-15T10:00:00Z');
const POLICY: DocumentUploadPolicy = {
  maxSizeBytes: 50 * MIB,
  uploadUrlTtlSeconds: 900,
  abandonedUploadTtlSeconds: 86_400,
};
const OWNER = OwnerId.of('user-1');

const doc = newDocumentAwaitingUpload({
  id: DocumentId.of('doc-1'),
  ownerId: OWNER,
  title: 'x' as DocumentTitle,
  sizeBytes: (12 * MIB) as DocumentSize,
  now: NOW,
});

describe('PrepareUploadPartsUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let useCase: PrepareUploadPartsUseCase;
  let uploadId: string;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    useCase = new PrepareUploadPartsUseCase(repo, storage, new FixedClock(NOW), POLICY);
    uploadId = await storage.createMultipartUpload(doc.sourceKey, 'application/pdf');
    await repo.insert(doc, uploadId);
  });

  const run = (ownerId = OWNER) => useCase.execute({ ownerId, documentId: doc.id });

  it('signs every part at its exact size at the start', async () => {
    const r = await run();

    expect(r.value.receivedParts).toEqual([]);
    expect(r.value.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(storage.presignedParts.map((p) => [p.partNumber, p.contentLength])).toEqual([
      [1, 5 * MIB],
      [2, 5 * MIB],
      [3, 2 * MIB],
    ]);
    expect(storage.presignedParts.every((p) => p.uploadId === uploadId)).toBe(true);
    expect(r.value.expiresAt).toEqual(new Date('2026-10-15T10:15:00Z'));
  });

  it('after a cut, signs only the missing (or truncated) parts', async () => {
    storage.seedPart(uploadId, 1, new Uint8Array(5 * MIB));
    storage.seedPart(uploadId, 2, new Uint8Array(1000));

    const r = await run();

    expect(r.value.receivedParts).toEqual([1]);
    expect(r.value.parts.map((p) => p.partNumber)).toEqual([2, 3]);
  });

  it.each([
    ['someone else’s document', async () => run(OwnerId.of('user-2')), 'DOCUMENT_NOT_FOUND'],
    [
      'an already confirmed document',
      async () => {
        repo.rows.set(doc.id, markUploaded(doc, NOW));
        return run();
      },
      DOCUMENT_ERROR_CODES.DOCUMENT_UPLOAD_CONFLICT,
    ],
    [
      'a single-PUT import',
      async () => {
        repo.uploadIds.delete(doc.id);
        return run();
      },
      DOCUMENT_ERROR_CODES.DOCUMENT_UPLOAD_CONFLICT,
    ],
    [
      'an upload already assembled or aborted',
      async () => {
        storage.multipart.delete(uploadId);
        return run();
      },
      DOCUMENT_ERROR_CODES.DOCUMENT_UPLOAD_CONFLICT,
    ],
  ])('refuses %s', async (_case, act, code) => {
    const r = await act();
    expect(r.isErr() && r.error.code).toBe(code);
  });
});
