import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { type Document, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { ConfirmDocumentUploadUseCase } from './confirm-document-upload.use-case';

const CREATED = new Date('2026-10-06T10:00:00Z');
const NOW = new Date('2026-10-06T10:03:00Z');
const OWNER = OwnerId.of('user-1');
const PDF = '%PDF-1.7 fake body';

describe('ConfirmDocumentUploadUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let useCase: ConfirmDocumentUploadUseCase;
  let doc: Document;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    useCase = new ConfirmDocumentUploadUseCase(repo, storage, new FixedClock(NOW));
    doc = newDocumentAwaitingUpload({
      id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
      ownerId: OWNER,
      title: 'Titre' as DocumentTitle,
      sizeBytes: PDF.length as DocumentSize,
      now: CREATED,
    });
    await repo.insert(doc);
  });

  const confirm = (ownerId = OWNER) => useCase.execute({ ownerId, documentId: doc.id });

  it('accepts a PDF of the declared size and marks the document uploaded', async () => {
    storage.put(doc.sourceKey, PDF);
    const r = await confirm();
    expect(r.value).toMatchObject({ status: DocumentStatus.UPLOADED, uploadedAt: NOW });
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.UPLOADED);
    expect(storage.objects.has(doc.sourceKey)).toBe(true);
  });

  it('is idempotent: a replayed confirmation returns the document without reading storage', async () => {
    storage.put(doc.sourceKey, PDF);
    await confirm();
    storage.failing = true; // prouve qu'aucun appel stockage n'est refait
    const again = await confirm();
    expect(again.value.status).toBe(DocumentStatus.UPLOADED);
  });

  it('answers DOCUMENT_NOT_FOUND for another owner (no existence leak)', async () => {
    storage.put(doc.sourceKey, PDF);
    const r = await confirm(OwnerId.of('intruder'));
    expect(r.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.AWAITING_UPLOAD);
  });

  it('reports a missing upload without deleting anything (upload may still be running)', async () => {
    const r = await confirm();
    expect(r.error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_UPLOAD);
    expect(r.error.details).toEqual({ documentId: doc.id, reason: 'missing' });
  });

  it('rejects and deletes a file whose size differs from the declared one', async () => {
    storage.put(doc.sourceKey, `${PDF} + extra`);
    const r = await confirm();
    expect(r.error.details).toMatchObject({ reason: 'size_mismatch' });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.AWAITING_UPLOAD);
  });

  it('rejects and deletes a file that is not a PDF, whatever its declared type', async () => {
    // Même taille que déclarée : seule la signature de contenu peut le rejeter.
    storage.put(doc.sourceKey, '<html>'.padEnd(PDF.length, 'x'), 'application/pdf');
    const r = await confirm();
    expect(r.error.details).toMatchObject({ reason: 'not_pdf' });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
  });

  it('propagates a storage outage (503 at the HTTP boundary)', async () => {
    storage.failing = true;
    await expect(confirm()).rejects.toMatchObject({ code: 'INFRASTRUCTURE_STORAGE_UNAVAILABLE' });
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.AWAITING_UPLOAD);
  });
});
