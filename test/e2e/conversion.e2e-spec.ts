import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { QUOTA_LEDGER } from '@/modules/billing/domain/ports/quota-ledger.port';
import { QUOTA_POLICY } from '@/modules/billing/domain/quota-policy';
import { CONVERSION_JOBS } from '@/modules/conversion/domain/ports/conversion-jobs.port';
import { CONVERSION_REPOSITORY } from '@/modules/conversion/domain/ports/conversion-repository.port';
import { DOCUMENT_REPOSITORY } from '@/modules/document/domain/ports/document-repository.port';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { UnauthorizedError } from '@/shared/kernel';
import { UNIT_OF_WORK } from '@/shared/persistence/unit-of-work.port';

import { bootstrapTestApp } from '../support';
import {
  FakeConversionJobs,
  ImmediateUnitOfWork,
  InMemoryConversionRepository,
  InMemoryDocumentRepository,
  InMemoryQuotaLedger,
} from '../support/fakes';

const USER_HEADER = 'x-test-user';
const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';
const POLICY = { freeTierCharsPerMonth: 1000, maxCharsPerConversion: 800 };

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
 * E2E conversions : AppModule complet — controllers, use-cases, adapters
 * inter-modules (`DocumentTextReader`, use-cases `billing`) et filter
 * RFC 7807 réels ; seules la persistance et la file sont des fakes.
 */
describe('conversions (e2e)', () => {
  let app: INestApplication;
  let documents: InMemoryDocumentRepository;
  let conversions: InMemoryConversionRepository;
  let jobs: FakeConversionJobs;

  beforeEach(async () => {
    documents = new InMemoryDocumentRepository();
    conversions = new InMemoryConversionRepository();
    jobs = new FakeConversionJobs();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(documents)
      .overrideProvider(CONVERSION_REPOSITORY)
      .useValue(conversions)
      .overrideProvider(CONVERSION_JOBS)
      .useValue(jobs)
      .overrideProvider(QUOTA_LEDGER)
      .useValue(new InMemoryQuotaLedger())
      .overrideProvider(QUOTA_POLICY)
      .useValue(POLICY)
      .overrideProvider(UNIT_OF_WORK)
      .useValue(new ImmediateUnitOfWork())
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function seedDocument(
    charCount: number,
    status: DocumentStatus = DocumentStatus.EXTRACTING,
  ) {
    const at = new Date('2026-10-06T10:00:00Z');
    await documents.insert({
      id: DocumentId.of(DOC),
      ownerId: 'alice' as never,
      title: 'Livre' as never,
      status,
      sizeBytes: 10 as never,
      sourceKey: 'documents/alice/x/source.pdf',
      rightsAttestedAt: at,
      rightsAttestationVersion: 'v1',
      uploadedAt: at,
      pageCount: null,
      charCount: null,
      textRevision: 0,
      extractionError: null,
      sourceDeletedAt: null,
      createdAt: at,
      updatedAt: at,
    });
    if (status === DocumentStatus.EXTRACTING) {
      await documents.completeExtraction(
        DocumentId.of(DOC),
        [{ pageNumber: 1, text: 'x'.repeat(charCount), charCount }],
        charCount,
        at,
      );
    }
  }

  it('launches a conversion (202), debits the quota once, and exposes its progress', async () => {
    await seedDocument(600);
    const start = () =>
      http()
        .post(`/v1/documents/${DOC}/conversions`)
        .set(USER_HEADER, 'alice')
        .send({ voiceId: 'fr-m1' });

    const first = await start().expect(202);
    expect(first.body).toMatchObject({
      documentId: DOC,
      voiceId: 'fr-m1',
      status: 'queued',
      reservedChars: 600,
      progress: { segmentsDone: 0, segmentCount: null },
      failureReason: null,
    });
    const id = first.body.id as string;
    expect(jobs.preparations).toEqual([id]);

    // Double clic : même conversion, aucun nouveau débit.
    const again = await start().expect(202);
    expect(again.body.id).toBe(id);
    const quota = await http().get('/v1/quota').set(USER_HEADER, 'alice').expect(200);
    expect(quota.body).toEqual({
      period: expect.stringMatching(/^\d{4}-\d{2}$/u) as string,
      limit: 1000,
      used: 600,
      remaining: 400,
      maxCharsPerConversion: 800,
    });

    const progress = await http()
      .get(`/v1/conversions/${id}`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(progress.body).toMatchObject({ id, status: 'queued' });
    const other = await http().get(`/v1/conversions/${id}`).set(USER_HEADER, 'bob').expect(404);
    expect(other.body.code).toBe('CONVERSION_NOT_FOUND');
  });

  it('402 QUOTA_EXCEEDED with what is left, 422 above the per-conversion cap', async () => {
    await seedDocument(900);
    const tooBig = await http()
      .post(`/v1/documents/${DOC}/conversions`)
      .set(USER_HEADER, 'alice')
      .send({})
      .expect(422)
      .expect('content-type', /application\/problem\+json/);
    expect(tooBig.body).toMatchObject({
      code: 'QUOTA_CONVERSION_LIMIT_EXCEEDED',
      details: { requested: 900, maxChars: 800 },
    });
  });

  it('402 QUOTA_EXCEEDED once the month is used up', async () => {
    await seedDocument(600);
    await http()
      .post(`/v1/documents/${DOC}/conversions`)
      .set(USER_HEADER, 'alice')
      .send({})
      .expect(202);
    const second = await http()
      .post(`/v1/documents/${DOC}/conversions`)
      .set(USER_HEADER, 'alice')
      .send({ voiceId: 'fr-m2' })
      .expect(402);
    expect(second.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: { requested: 600, remaining: 400 },
    });
  });

  it('409 while the text is not ready, 404 for another user, 422 for an unknown voice', async () => {
    await seedDocument(0, DocumentStatus.UPLOADED);
    const start = (user: string, body: object = {}) =>
      http().post(`/v1/documents/${DOC}/conversions`).set(USER_HEADER, user).send(body);
    const notReady = await start('alice').expect(409);
    expect(notReady.body).toMatchObject({
      code: 'DOCUMENT_TEXT_NOT_READY',
      details: { status: 'uploaded' },
    });
    const foreign = await start('bob').expect(404);
    expect(foreign.body.code).toBe('DOCUMENT_NOT_FOUND');
    const voice = await start('alice', { voiceId: 'fr-FR-Wavenet-A' }).expect(422);
    expect(voice.body).toMatchObject({
      code: 'INVALID_VOICE',
      details: { voices: ['fr-f1', 'fr-m1', 'fr-f2', 'fr-m2'] },
    });
    await start('alice', { voiceId: 'fr-f1', speed: 2 }).expect(400); // champ inconnu
    await http()
      .post('/v1/documents/not-a-uuid/conversions')
      .set(USER_HEADER, 'alice')
      .send({})
      .expect(400);
  });

  it('lists the voices, and requires a session everywhere', async () => {
    const voices = await http().get('/v1/voices').set(USER_HEADER, 'alice').expect(200);
    expect(voices.body.items).toHaveLength(4);
    expect(voices.body.items[0]).toEqual({
      id: 'fr-f1',
      label: 'Voix féminine 1',
      gender: 'female',
      languageCode: 'fr-FR',
      isDefault: true,
    });
    await http().get('/v1/voices').expect(401);
    await http().get('/v1/quota').expect(401);
    await http().post(`/v1/documents/${DOC}/conversions`).send({}).expect(401);
  });
});
