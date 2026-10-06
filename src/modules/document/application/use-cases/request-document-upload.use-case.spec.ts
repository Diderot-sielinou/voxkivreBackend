import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { type DocumentUploadPolicy } from '../../domain/document-upload-policy';
import { PDF_CONTENT_TYPE } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { RequestDocumentUploadUseCase } from './request-document-upload.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');
const POLICY: DocumentUploadPolicy = {
  maxSizeBytes: 1000,
  uploadUrlTtlSeconds: 900,
  abandonedUploadTtlSeconds: 86_400,
};
const OWNER = OwnerId.of('user-1');

describe('RequestDocumentUploadUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let useCase: RequestDocumentUploadUseCase;

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    useCase = new RequestDocumentUploadUseCase(repo, storage, new FixedClock(NOW), POLICY);
  });

  it('persists an awaiting_upload document and signs a PUT for its exact size', async () => {
    const r = await useCase.execute({
      ownerId: OWNER,
      title: ' Mon cours ',
      sizeBytes: 500,
      rightsAttested: true,
    });

    const { document, upload } = r.value;
    expect(document).toMatchObject({
      ownerId: OWNER,
      title: 'Mon cours',
      status: DocumentStatus.AWAITING_UPLOAD,
      sizeBytes: 500,
      rightsAttestedAt: NOW,
    });
    expect(repo.rows.get(document.id)).toEqual(document);
    expect(storage.presigned).toEqual([
      {
        key: document.sourceKey,
        contentType: PDF_CONTENT_TYPE,
        contentLength: 500,
        expiresInSeconds: 900,
      },
    ]);
    expect(upload.method).toBe('PUT');
    expect(upload.expiresAt).toEqual(new Date('2026-10-06T10:15:00Z'));
  });

  it('generates a new UUID v7 per request (no collision between two imports)', async () => {
    const input = { ownerId: OWNER, title: 'x', sizeBytes: 1, rightsAttested: true };
    const a = await useCase.execute(input);
    const b = await useCase.execute(input);
    expect(a.value.document.id).not.toBe(b.value.document.id);
    expect(a.value.document.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it.each([
    [{ rightsAttested: false }, DOCUMENT_ERROR_CODES.INVALID_RIGHTS_ATTESTATION],
    [{ title: '   ' }, DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_TITLE],
    [{ sizeBytes: 1001 }, DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_SIZE],
    [{ sizeBytes: 0 }, DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_SIZE],
  ])('rejects %p with %s and persists nothing', async (override, code) => {
    const r = await useCase.execute({
      ownerId: OWNER,
      title: 'ok',
      sizeBytes: 10,
      rightsAttested: true,
      ...override,
    });
    expect(r.error.code).toBe(code);
    expect(repo.rows.size).toBe(0);
    expect(storage.presigned).toHaveLength(0);
  });

  it('creates no row when signing fails (storage not configured or down)', async () => {
    storage.presignPut = () => Promise.reject(new Error('storage down'));
    await expect(
      useCase.execute({ ownerId: OWNER, title: 'x', sizeBytes: 1, rightsAttested: true }),
    ).rejects.toThrow('storage down');
    expect(repo.rows.size).toBe(0);
  });
});
