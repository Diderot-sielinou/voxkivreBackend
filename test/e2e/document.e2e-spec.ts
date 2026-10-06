import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { DOCUMENT_REPOSITORY } from '@/modules/document/domain/ports/document-repository.port';
import { EXTRACTION_SCHEDULER } from '@/modules/document/domain/ports/extraction-scheduler.port';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { UnauthorizedError } from '@/shared/kernel';
import { OBJECT_STORAGE } from '@/shared/storage';

import { bootstrapTestApp } from '../support';
import {
  FakeExtractionScheduler,
  FakeObjectStorage,
  InMemoryDocumentRepository,
} from '../support/fakes';

const PDF = '%PDF-1.7 e2e body';
const USER_HEADER = 'x-test-user';

/**
 * Remplace le `SessionGuard` (better-auth, testé en intégration) : l'identité
 * vient d'un en-tête de test. Sans en-tête → même 401 que le vrai guard.
 */
const headerSessionGuard: CanActivate = {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = req.headers[USER_HEADER];
    if (typeof id !== 'string') throw new UnauthorizedError('Session required');
    req.authUser = { id, email: `${id}@test.cm`, role: 'user' as never };
    return true;
  },
};

/**
 * E2E documents : AppModule complet, wiring HTTP → use-cases → DTO réel ;
 * repository et stockage remplacés par des fakes. Une app par test : le
 * rate-limit global (10 req/s) ne doit pas fuiter d'un test à l'autre.
 */
describe('documents (e2e)', () => {
  let app: INestApplication;
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let scheduler: FakeExtractionScheduler;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    scheduler = new FakeExtractionScheduler();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(repo)
      .overrideProvider(EXTRACTION_SCHEDULER)
      .useValue(scheduler)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function createDocument(user = 'alice', sizeBytes = PDF.length) {
    const res = await http()
      .post('/v1/documents')
      .set(USER_HEADER, user)
      .send({ title: 'Cours de droit', sizeBytes, rightsAttested: true })
      .expect(201);
    return res.body as { document: { id: string }; upload: { url: string } };
  }

  it('full import flow: create → upload → confirm → get → list', async () => {
    const created = await createDocument();
    expect(created).toMatchObject({
      document: { title: 'Cours de droit', status: 'awaiting_upload', sizeBytes: PDF.length },
      upload: {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) },
      },
    });
    expect(created.document).not.toHaveProperty('sourceKey');

    // Le mobile envoie le fichier directement au stockage (simulé).
    const sourceKey = storage.presigned[0]?.key ?? '';
    storage.seed(sourceKey, PDF);

    const id = created.document.id;
    const confirmed = await http()
      .post(`/v1/documents/${id}/upload-confirmation`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(confirmed.body).toMatchObject({ id, status: 'uploaded', pageCount: null });
    expect(scheduler.scheduled).toEqual([id]);

    await http().get(`/v1/documents/${id}`).set(USER_HEADER, 'alice').expect(200);
    const list = await http().get('/v1/documents').set(USER_HEADER, 'alice').expect(200);
    expect(list.body).toMatchObject({ items: [{ id }], nextCursor: null });
  });

  it('401 problem+json without a session', async () => {
    const res = await http()
      .get('/v1/documents')
      .expect(401)
      .expect('content-type', /application\/problem\+json/);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('422 with stable codes for business rules', async () => {
    const send = (body: object) =>
      http().post('/v1/documents').set(USER_HEADER, 'alice').send(body).expect(422);
    const base = { title: 'ok', sizeBytes: 10, rightsAttested: true };
    const noRights = await send({ ...base, rightsAttested: false });
    const blankTitle = await send({ ...base, title: '  ' });
    expect(noRights.body.code).toBe('INVALID_RIGHTS_ATTESTATION');
    expect(blankTitle.body.code).toBe('INVALID_DOCUMENT_TITLE');
    const tooBig = await send({ ...base, sizeBytes: 50 * 1024 * 1024 + 1 });
    expect(tooBig.body).toMatchObject({
      code: 'INVALID_DOCUMENT_SIZE',
      details: { maxSizeBytes: 52_428_800 },
    });
  });

  it('400 on unknown fields or malformed input (ValidationPipe)', async () => {
    const unknownField = await http()
      .post('/v1/documents')
      .set(USER_HEADER, 'alice')
      .send({ title: 'x', sizeBytes: 10, rightsAttested: true, ownerId: 'bob' })
      .expect(400);
    expect(unknownField.body.detail).toContain('ownerId should not exist');
    await http()
      .post('/v1/documents')
      .set(USER_HEADER, 'alice')
      .send({ title: 'x', sizeBytes: '10', rightsAttested: true })
      .expect(400);
    await http().get('/v1/documents/not-a-uuid').set(USER_HEADER, 'alice').expect(400);
    await http().get('/v1/documents?limit=51').set(USER_HEADER, 'alice').expect(400);
  });

  it("another user's document is a 404, never a 403 (RNF-08)", async () => {
    const { document } = await createDocument('alice');
    const res = await http()
      .get(`/v1/documents/${document.id}`)
      .set(USER_HEADER, 'bob')
      .expect(404);
    expect(res.body.code).toBe('DOCUMENT_NOT_FOUND');
    await http()
      .post(`/v1/documents/${document.id}/upload-confirmation`)
      .set(USER_HEADER, 'bob')
      .expect(404);
  });

  it('422 INVALID_DOCUMENT_UPLOAD with a stable reason when the file is missing or not a PDF', async () => {
    const { document } = await createDocument();
    const confirm = () =>
      http().post(`/v1/documents/${document.id}/upload-confirmation`).set(USER_HEADER, 'alice');

    const missing = await confirm().expect(422);
    expect(missing.body.details).toMatchObject({ reason: 'missing' });
    storage.seed(storage.presigned[0]?.key ?? '', '<html>'.padEnd(PDF.length, 'x'));
    const notPdf = await confirm().expect(422);
    expect(notPdf.body.details).toMatchObject({ reason: 'not_pdf' });
  });

  it('422 INVALID_CURSOR on a forged cursor', async () => {
    const res = await http()
      .get('/v1/documents?cursor=forged.cursor')
      .set(USER_HEADER, 'alice')
      .expect(422);
    expect(res.body.code).toBe('INVALID_CURSOR');
  });

  it('paginates with nextCursor', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { document } = await createDocument();
      storage.seed(storage.presigned.at(-1)?.key ?? '', PDF);
      await http()
        .post(`/v1/documents/${document.id}/upload-confirmation`)
        .set(USER_HEADER, 'alice')
        .expect(200);
    }
    const first = await http().get('/v1/documents?limit=2').set(USER_HEADER, 'alice').expect(200);
    expect(first.body.items).toHaveLength(2);
    const second = await http()
      .get(`/v1/documents?limit=2&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('503 INFRASTRUCTURE_STORAGE_UNAVAILABLE when storage is down (RNF-11)', async () => {
    const { document } = await createDocument();
    storage.failing = true;
    const res = await http()
      .post(`/v1/documents/${document.id}/upload-confirmation`)
      .set(USER_HEADER, 'alice')
      .expect(503);
    expect(res.body.code).toBe('INFRASTRUCTURE_STORAGE_UNAVAILABLE');
  });
});

describe('document pages (e2e)', () => {
  let app: INestApplication;
  let repo: InMemoryDocumentRepository;
  const id = DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b');

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(repo)
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);

    // Document extrait : statut + pages, comme après le worker.
    const created = new Date('2026-10-06T10:00:00Z');
    await repo.insert({
      id,
      ownerId: 'alice' as never,
      title: 'Livre' as never,
      status: DocumentStatus.EXTRACTING,
      sizeBytes: 10 as never,
      sourceKey: 'documents/alice/x/source.pdf',
      rightsAttestedAt: created,
      rightsAttestationVersion: 'v1',
      uploadedAt: created,
      pageCount: null,
      charCount: null,
      textRevision: 0,
      extractionError: null,
      sourceDeletedAt: null,
      createdAt: created,
      updatedAt: created,
    });
    await repo.completeExtraction(
      id,
      [
        { pageNumber: 1, text: 'Première page', charCount: 13 },
        { pageNumber: 2, text: 'Deuxième page', charCount: 13 },
      ],
      26,
      created,
    );
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('lists the extracted pages and exposes the counters on the document', async () => {
    const pages = await http()
      .get(`/v1/documents/${id}/pages`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(pages.body).toMatchObject({
      items: [
        { pageNumber: 1, text: 'Première page', charCount: 13 },
        { pageNumber: 2, text: 'Deuxième page', charCount: 13 },
      ],
      nextCursor: null,
    });
    const doc = await http().get(`/v1/documents/${id}`).set(USER_HEADER, 'alice').expect(200);
    expect(doc.body).toMatchObject({ status: 'text_ready', pageCount: 2, charCount: 26 });
  });

  it('corrects a page and recomputes the document character count', async () => {
    const res = await http()
      .put(`/v1/documents/${id}/pages/2`)
      .set(USER_HEADER, 'alice')
      .send({ text: 'Page corrigée' })
      .expect(200);
    expect(res.body).toMatchObject({ pageNumber: 2, text: 'Page corrigée', charCount: 13 });
    const doc = await http().get(`/v1/documents/${id}`).set(USER_HEADER, 'alice').expect(200);
    expect(doc.body.charCount).toBe(26);
  });

  it('404 for an unknown page or another owner, 400 for a non-numeric page', async () => {
    const page = await http()
      .put(`/v1/documents/${id}/pages/9`)
      .set(USER_HEADER, 'alice')
      .send({ text: 'x' })
      .expect(404);
    expect(page.body.code).toBe('DOCUMENT_PAGE_NOT_FOUND');
    const other = await http().get(`/v1/documents/${id}/pages`).set(USER_HEADER, 'bob').expect(404);
    expect(other.body.code).toBe('DOCUMENT_NOT_FOUND');
    await http()
      .put(`/v1/documents/${id}/pages/deux`)
      .set(USER_HEADER, 'alice')
      .send({ text: 'x' })
      .expect(400);
  });

  it('409 DOCUMENT_TEXT_NOT_READY while extraction has failed', async () => {
    await repo.markExtractionFailed(id, 'scanned', new Date());
    const doc = repo.rows.get(id);
    if (doc !== undefined) {
      repo.rows.set(id, {
        ...doc,
        status: DocumentStatus.EXTRACTION_FAILED,
        extractionError: 'scanned',
      });
    }
    const res = await http().get(`/v1/documents/${id}/pages`).set(USER_HEADER, 'alice').expect(409);
    expect(res.body).toMatchObject({
      code: 'DOCUMENT_TEXT_NOT_READY',
      details: { status: 'extraction_failed' },
    });
    const meta = await http().get(`/v1/documents/${id}`).set(USER_HEADER, 'alice').expect(200);
    expect(meta.body.extractionError).toBe('scanned');
  });
});

describe('documents (e2e, storage not configured)', () => {
  it('boots without S3_* and answers 503 INFRASTRUCTURE_STORAGE_NOT_CONFIGURED', async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(new InMemoryDocumentRepository())
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    const app = await bootstrapTestApp(moduleFixture);
    try {
      const res = await request(app.getHttpServer())
        .post('/v1/documents')
        .set(USER_HEADER, 'alice')
        .send({ title: 'x', sizeBytes: 10, rightsAttested: true })
        .expect(503);
      expect(res.body.code).toBe('INFRASTRUCTURE_STORAGE_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });
});
