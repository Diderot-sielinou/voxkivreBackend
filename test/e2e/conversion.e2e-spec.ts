import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { GrantOfferUseCase } from '@/modules/billing/application/use-cases/grant-offer.use-case';
import { OFFER_CATALOG } from '@/modules/billing/domain/ports/offer-catalog.port';
import { PURCHASE_LEDGER } from '@/modules/billing/domain/ports/purchase-ledger.port';
import { UNITS_LEDGER } from '@/modules/billing/domain/ports/units-ledger.port';
import { WALLET_HISTORY } from '@/modules/billing/domain/ports/wallet-history.port';
import { QUOTA_POLICY } from '@/modules/billing/domain/quota-policy';
import { AssemblePartUseCase } from '@/modules/conversion/application/use-cases/assemble-part.use-case';
import { PrepareConversionUseCase } from '@/modules/conversion/application/use-cases/prepare-conversion.use-case';
import { SynthesizeSegmentUseCase } from '@/modules/conversion/application/use-cases/synthesize-segment.use-case';
import { CONVERSION_JOBS } from '@/modules/conversion/domain/ports/conversion-jobs.port';
import { CONVERSION_REPOSITORY } from '@/modules/conversion/domain/ports/conversion-repository.port';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { DOCUMENT_REPOSITORY } from '@/modules/document/domain/ports/document-repository.port';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { UnauthorizedError } from '@/shared/kernel';
import { UNIT_OF_WORK } from '@/shared/persistence/unit-of-work.port';
import { OBJECT_STORAGE } from '@/shared/storage';

import { bootstrapTestApp } from '../support';
import {
  FakeConversionJobs,
  FakeObjectStorage,
  ImmediateUnitOfWork,
  InMemoryBilling,
  InMemoryConversionRepository,
  InMemoryDocumentRepository,
} from '../support/fakes';

const USER_HEADER = 'x-test-user';
const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';
const POLICY = { freeTierUnitsPerMonth: 1000, maxCharsPerConversion: 800 };

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
  let billing: InMemoryBilling;

  beforeEach(async () => {
    billing = new InMemoryBilling();
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
      .overrideProvider(UNITS_LEDGER)
      .useValue(billing)
      .overrideProvider(PURCHASE_LEDGER)
      .useValue(billing)
      .overrideProvider(OFFER_CATALOG)
      .useValue(billing)
      .overrideProvider(WALLET_HISTORY)
      .useValue(billing)
      .overrideProvider(QUOTA_POLICY)
      .useValue(POLICY)
      .overrideProvider(UNIT_OF_WORK)
      .useValue(new ImmediateUnitOfWork())
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new FakeObjectStorage())
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
        [{ pageNumber: 1, text: 'x'.repeat(charCount), charCount, setAside: [] }],
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
        .send({ voiceId: 'fr-m2' });

    const first = await start().expect(202);
    expect(first.body).toMatchObject({
      documentId: DOC,
      voiceId: 'fr-m2',
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
    const account = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
    expect(account.body).toEqual({
      period: expect.stringMatching(/^\d{4}-\d{2}$/u) as string,
      free: { limit: 1000, used: 600, remaining: 400 },
      pass: null,
      nextPassStartsAt: null,
      credits: 0,
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
      details: { requested: 600, usable: 400, tier: 'standard' },
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
    const voice = await start('alice', { voiceId: 'Lea' }).expect(422);
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

  it('serves the manifest with signed URLs once the first part is assembled, then the whole book', async () => {
    await seedDocument(600);
    const start = await http()
      .post(`/v1/documents/${DOC}/conversions`)
      .set(USER_HEADER, 'alice')
      .send({})
      .expect(202);
    const id = ConversionId.of(start.body.id as string);
    const manifest = () => http().get(`/v1/conversions/${id}/manifest`).set(USER_HEADER, 'alice');

    const early = await manifest().expect(409);
    expect(early.body).toMatchObject({
      code: 'CONVERSION_NOT_READY',
      details: { status: 'queued' },
    });

    // Les workers sont coupés en e2e : on joue le pipeline avec les vrais use-cases.
    await app.get(PrepareConversionUseCase).execute(id);
    for (const index of await conversions.listPendingSegmentIndexes(id)) {
      await app.get(SynthesizeSegmentUseCase).execute(id, index);
    }
    for (const part of await conversions.listParts(id)) {
      await app.get(AssemblePartUseCase).execute(id, part.index);
    }

    const ready = await manifest().expect(200);
    expect(ready.body).toMatchObject({
      version: 1,
      conversionId: id,
      documentId: DOC,
      voiceId: 'fr-f2',
      complete: true,
      partCount: 1,
    });
    expect(ready.body.parts[0]).toMatchObject({
      index: 0,
      status: 'ready',
      startMs: 0,
      audio: { name: 'part-001.mp3', url: expect.stringContaining('signature=') as string },
      vtt: { name: 'part-001.vtt' },
    });
    // Seuls les noms et les URL signées sortent, jamais un champ de clé interne.
    expect(ready.body.parts[0].audio).not.toHaveProperty('key');

    const progress = await http()
      .get(`/v1/conversions/${id}`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(progress.body).toMatchObject({
      status: 'ready',
      progress: { partsReady: 1, partCount: 1 },
    });
    await http().get(`/v1/conversions/${id}/manifest`).set(USER_HEADER, 'bob').expect(404);
  });

  it('lists the voices, and requires a session everywhere', async () => {
    const voices = await http().get('/v1/voices').set(USER_HEADER, 'alice').expect(200);
    expect(voices.body.items).toHaveLength(4);
    expect(voices.body.items[0]).toEqual({
      id: 'fr-f1',
      label: 'Voix féminine naturelle',
      gender: 'female',
      languageCode: 'fr-FR',
      tier: 'natural',
      isDefault: false,
    });
    expect(voices.body.items[2]).toMatchObject({ id: 'fr-f2', tier: 'standard', isDefault: true });
    await http().get('/v1/voices').expect(401);
    await http().get('/v1/billing/account').expect(401);
    await http().get('/v1/billing/offers').expect(401);
    await http().get('/v1/billing/wallet/entries').expect(401);
    await http().post(`/v1/documents/${DOC}/conversions`).send({}).expect(401);
  });

  describe('billing (ADR-0019)', () => {
    const grant = (offerCode: string, paymentReference: string) =>
      app.get(GrantOfferUseCase).execute({ userId: 'alice', offerCode, paymentReference });

    it('lists the offers on sale with the voice weights', async () => {
      const offers = await http().get('/v1/billing/offers').set(USER_HEADER, 'alice').expect(200);
      expect(offers.body.voiceTierWeights).toEqual({ standard: 1, natural: 4 });
      expect(offers.body.items[0]).toEqual({
        code: 'pass-30d',
        kind: 'pass',
        priceXaf: 2000,
        units: 250_000,
        durationDays: 30,
      });
      expect(offers.body.items.map((o: { code: string }) => o.code)).toEqual([
        'pass-30d',
        'credits-s',
        'credits-m',
        'credits-l',
      ]);
    });

    it('402 for a natural voice on the free tier alone, then pays it with credits ×4', async () => {
      await seedDocument(100);
      const refused = await http()
        .post(`/v1/documents/${DOC}/conversions`)
        .set(USER_HEADER, 'alice')
        .send({ voiceId: 'fr-f1' })
        .expect(402);
      expect(refused.body).toMatchObject({
        code: 'QUOTA_EXCEEDED',
        details: { requested: 400, usable: 0, tier: 'natural', available: { free: 1000 } },
      });

      await grant('credits-s', 'pay-1');
      await http()
        .post(`/v1/documents/${DOC}/conversions`)
        .set(USER_HEADER, 'alice')
        .send({ voiceId: 'fr-f1' })
        .expect(202);
      const account = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
      expect(account.body).toMatchObject({ free: { used: 0 }, credits: 49_600 });

      const entries = await http()
        .get('/v1/billing/wallet/entries?limit=1')
        .set(USER_HEADER, 'alice')
        .expect(200);
      expect(entries.body.items).toEqual([
        expect.objectContaining({ kind: 'consumption', units: -400, offerCode: null }),
      ]);
      expect(entries.body.nextCursor).toEqual(expect.any(String));
      const older = await http()
        .get(`/v1/billing/wallet/entries?cursor=${String(entries.body.nextCursor)}`)
        .set(USER_HEADER, 'alice')
        .expect(200);
      expect(older.body.items).toEqual([
        expect.objectContaining({ kind: 'purchase', units: 50_000, offerCode: 'credits-s' }),
      ]);
    });

    it('shows a running pass, and 422 for a tampered cursor', async () => {
      await grant('pass-30d', 'pay-1');
      const account = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
      expect(account.body.pass).toMatchObject({ includedUnits: 250_000, remainingUnits: 250_000 });
      const bad = await http()
        .get('/v1/billing/wallet/entries?cursor=abc.def')
        .set(USER_HEADER, 'alice')
        .expect(422);
      expect(bad.body.code).toBe('INVALID_CURSOR');
    });
  });
});
