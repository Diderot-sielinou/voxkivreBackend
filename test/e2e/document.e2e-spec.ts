import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { DOCUMENT_REPOSITORY } from '@/modules/document/domain/ports/document-repository.port';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { UnauthorizedError } from '@/shared/kernel';
import { OBJECT_STORAGE } from '@/shared/storage';

import { bootstrapTestApp } from '../support';
import { FakeObjectStorage, InMemoryDocumentRepository } from '../support/fakes';

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

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(repo)
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
    storage.put(sourceKey, PDF);

    const id = created.document.id;
    const confirmed = await http()
      .post(`/v1/documents/${id}/upload-confirmation`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(confirmed.body).toMatchObject({ id, status: 'uploaded' });

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
    storage.put(storage.presigned[0]?.key ?? '', '<html>'.padEnd(PDF.length, 'x'));
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
      storage.put(storage.presigned.at(-1)?.key ?? '', PDF);
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
