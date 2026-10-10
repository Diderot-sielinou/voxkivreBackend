import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { newQueuedConversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { CONVERSION_REPOSITORY } from '@/modules/conversion/domain/ports/conversion-repository.port';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '@/modules/conversion/domain/value-objects/conversion-status.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';
import { DOCUMENT_REPOSITORY } from '@/modules/document/domain/ports/document-repository.port';
import { DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { FILE_DELETION_OUTBOX } from '@/modules/library/domain/ports/file-deletion-outbox.port';
import { READING_POSITION_REPOSITORY } from '@/modules/library/domain/ports/reading-position-repository.port';
import { CLOCK, UnauthorizedError } from '@/shared/kernel';
import { UNIT_OF_WORK } from '@/shared/persistence/unit-of-work.port';
import { OBJECT_STORAGE } from '@/shared/storage';

import { bootstrapTestApp } from '../support';
import {
  FakeObjectStorage,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryConversionRepository,
  InMemoryDocumentRepository,
  InMemoryFileDeletionOutbox,
  InMemoryReadingPositionRepository,
} from '../support/fakes';

const USER_HEADER = 'x-test-user';
const NOW = new Date('2026-10-10T10:00:00Z');
const READY_DOC = '01a12000-0000-7000-8000-000000000001';
const EXTRACTING_DOC = '01a12000-0000-7000-8000-000000000002';
const TEXT_ONLY_DOC = '01a12000-0000-7000-8000-000000000003';
const RUNNING_DOC = '01a12000-0000-7000-8000-000000000004';
const READY_CONV = '01a12000-0000-7000-8000-0000000000c1';
const RUNNING_CONV = '01a12000-0000-7000-8000-0000000000c2';

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
 * E2E bibliothèque (ADR-0015, ADR-0016) : AppModule complet — contrôleurs,
 * use-cases, adapters inter-modules réels (`DocumentCatalog`,
 * `ConversionCatalog`) et filtre RFC 7807 ; seules la persistance et le
 * stockage sont des fakes.
 */
describe('library (e2e)', () => {
  let app: INestApplication;
  let documents: InMemoryDocumentRepository;
  let conversions: InMemoryConversionRepository;
  let positions: InMemoryReadingPositionRepository;
  let outbox: InMemoryFileDeletionOutbox;

  async function seedDocument(id: string, minutes: number, status: DocumentStatus) {
    const at = new Date(NOW.getTime() + minutes * 60_000);
    await documents.insert({
      id: DocumentId.of(id),
      ownerId: 'alice' as never,
      title: `Livre ${String(minutes)}` as never,
      status,
      sizeBytes: 10 as never,
      sourceKey: `documents/alice/${id}/source.pdf`,
      rightsAttestedAt: at,
      rightsAttestationVersion: 'v1',
      uploadedAt: at,
      pageCount: status === DocumentStatus.TEXT_READY ? 3 : null,
      charCount: status === DocumentStatus.TEXT_READY ? 5000 : null,
      textRevision: 1,
      extractionError: null,
      sourceDeletedAt: status === DocumentStatus.TEXT_READY ? at : null,
      createdAt: at,
      updatedAt: at,
    });
  }

  async function seedConversion(id: string, documentId: string, status: ConversionStatus) {
    await conversions.insert({
      ...newQueuedConversion({
        id: ConversionId.of(id),
        ownerId: 'alice',
        documentId,
        voiceId: 'fr-f1' as VoiceId,
        textRevision: 1,
        reservedChars: 5000,
        now: NOW,
      }),
      status,
      partCount: 1,
    });
    conversions.parts.set(id, [
      {
        conversionId: ConversionId.of(id),
        index: 0,
        firstSegment: 0,
        lastSegment: 0,
        firstWordIndex: 0,
        assembled:
          status === ConversionStatus.READY
            ? {
                audio: { key: `conversions/alice/${id}/part-001.mp3`, bytes: 1, sha256: 'x' },
                vtt: { key: `conversions/alice/${id}/part-001.vtt`, bytes: 1, sha256: 'y' },
                durationMs: 600_000,
                wordCount: 1000,
                pageStarts: [],
              }
            : null,
      },
    ]);
  }

  beforeEach(async () => {
    documents = new InMemoryDocumentRepository();
    conversions = new InMemoryConversionRepository();
    positions = new InMemoryReadingPositionRepository();
    outbox = new InMemoryFileDeletionOutbox();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DOCUMENT_REPOSITORY)
      .useValue(documents)
      .overrideProvider(CONVERSION_REPOSITORY)
      .useValue(conversions)
      .overrideProvider(READING_POSITION_REPOSITORY)
      .useValue(positions)
      .overrideProvider(FILE_DELETION_OUTBOX)
      .useValue(outbox)
      .overrideProvider(UNIT_OF_WORK)
      .useValue(new ImmediateUnitOfWork())
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new FakeObjectStorage())
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(NOW))
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);

    await seedDocument(READY_DOC, 0, DocumentStatus.TEXT_READY);
    await seedDocument(EXTRACTING_DOC, 1, DocumentStatus.EXTRACTING);
    await seedDocument(TEXT_ONLY_DOC, 2, DocumentStatus.TEXT_READY);
    await seedDocument(RUNNING_DOC, 3, DocumentStatus.TEXT_READY);
    await seedConversion(READY_CONV, READY_DOC, ConversionStatus.READY);
    await seedConversion(RUNNING_CONV, RUNNING_DOC, ConversionStatus.SYNTHESIZING);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const putPosition = (wordIndex: number, recordedAt: string, user = 'alice', conv = READY_CONV) =>
    http()
      .put(`/v1/conversions/${conv}/position`)
      .set(USER_HEADER, user)
      .send({ wordIndex, audioMs: wordIndex * 600, recordedAt });

  it('lists every book with a derived status, newest first', async () => {
    await putPosition(499, '2026-10-10T09:59:00Z').expect(200);

    const res = await http().get('/v1/library').set(USER_HEADER, 'alice').expect(200);
    const body = res.body as {
      items: { status: string; progressPercent: number | null; document: { id: string } }[];
      nextCursor: string | null;
    };
    expect(body.items.map((i) => [i.document.id, i.status, i.progressPercent])).toEqual([
      [RUNNING_DOC, 'processing', null],
      [TEXT_ONLY_DOC, 'not_converted', null],
      [EXTRACTING_DOC, 'processing', null],
      [READY_DOC, 'in_progress', 50],
    ]);
    expect(body.nextCursor).toBeNull();

    const bob = await http().get('/v1/library').set(USER_HEADER, 'bob').expect(200);
    expect((bob.body as { items: unknown[] }).items).toEqual([]);
  });

  it('saves and resumes a position; the newest one wins across devices', async () => {
    const phone = await putPosition(500, '2026-10-10T09:50:00Z').expect(200);
    expect(phone.body).toMatchObject({ applied: true, wordIndex: 500 });

    // Tablette restée hors-ligne : sa position, plus ancienne, arrive après.
    const tablet = await putPosition(100, '2026-10-10T09:00:00Z').expect(200);
    expect(tablet.body).toMatchObject({ applied: false, wordIndex: 500 });

    const resume = await http()
      .get(`/v1/conversions/${READY_CONV}/position`)
      .set(USER_HEADER, 'alice')
      .expect(200);
    expect(resume.body).toMatchObject({ wordIndex: 500, audioMs: 300_000 });
  });

  it('rejects invalid positions with stable codes', async () => {
    // Forme invalide : ValidationPipe → 400.
    await putPosition(-1, '2026-10-10T09:00:00Z').expect(400);
    await putPosition(1, 'yesterday').expect(400);

    const outOfRange = await putPosition(1000, '2026-10-10T09:00:00Z').expect(422);
    expect(outOfRange.body).toMatchObject({
      code: 'INVALID_READING_POSITION',
      details: { reason: 'word_out_of_range' },
    });
    const future = await putPosition(1, '2026-10-10T11:00:00Z').expect(422);
    expect(future.body).toMatchObject({ details: { reason: 'recorded_in_future' } });

    const notReady = await putPosition(0, '2026-10-10T09:00:00Z', 'alice', RUNNING_CONV).expect(
      409,
    );
    expect(notReady.body).toMatchObject({ code: 'CONVERSION_NOT_READY' });

    const foreign = await putPosition(1, '2026-10-10T09:00:00Z', 'bob').expect(404);
    expect(foreign.body).toMatchObject({ code: 'CONVERSION_NOT_FOUND' });

    const never = await http()
      .get(`/v1/conversions/${READY_CONV}/position`)
      .set(USER_HEADER, 'alice')
      .expect(404);
    expect(never.body).toMatchObject({ code: 'READING_POSITION_NOT_FOUND' });
  });

  it('deletes a book: 204, files queued, then 404 everywhere', async () => {
    await http().delete(`/v1/documents/${READY_DOC}`).set(USER_HEADER, 'alice').expect(204);

    expect([...outbox.rows.keys()]).toEqual([
      `conversions/alice/${READY_CONV}/manifest.json`,
      `conversions/alice/${READY_CONV}/part-001.mp3`,
      `conversions/alice/${READY_CONV}/part-001.vtt`,
    ]);
    await http().get(`/v1/documents/${READY_DOC}`).set(USER_HEADER, 'alice').expect(404);
    const replay = await http()
      .delete(`/v1/documents/${READY_DOC}`)
      .set(USER_HEADER, 'alice')
      .expect(404);
    expect(replay.body).toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
  });

  it("409 while converting, 404 for someone else's book, 401 without a session", async () => {
    const running = await http()
      .delete(`/v1/documents/${RUNNING_DOC}`)
      .set(USER_HEADER, 'alice')
      .expect(409);
    expect(running.body).toMatchObject({ code: 'DOCUMENT_DELETION_CONFLICT' });

    await http().delete(`/v1/documents/${TEXT_ONLY_DOC}`).set(USER_HEADER, 'bob').expect(404);
    await http().delete(`/v1/documents/${TEXT_ONLY_DOC}`).expect(401);
    await http().get('/v1/library').expect(401);
    await http().put(`/v1/conversions/${READY_CONV}/position`).send({}).expect(401);
  });
});
