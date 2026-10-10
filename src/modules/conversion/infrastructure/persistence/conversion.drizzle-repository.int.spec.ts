import { RefundQuotaUseCase } from '@/modules/billing/application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '@/modules/billing/application/use-cases/reserve-quota.use-case';
import { DrizzleUnitsLedger } from '@/modules/billing/infrastructure/persistence/units-ledger.drizzle-repository';
import { uuidV7 } from '@/shared/kernel';
import { DrizzleUnitOfWork } from '@/shared/persistence/drizzle-unit-of-work';

import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import {
  FakeConversionJobs,
  FakeDocumentTextSource,
  FixedClock,
} from '../../../../../test/support/fakes';
import { documents } from '../../../document/infrastructure/persistence/schema/document.schema';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import { FailConversionUseCase } from '../../application/use-cases/fail-conversion.use-case';
import { StartConversionUseCase } from '../../application/use-cases/start-conversion.use-case';
import { type PreparedSegment } from '../../domain/entities/conversion-segment.entity';
import { newQueuedConversion, type Conversion } from '../../domain/entities/conversion.entity';
import { ConversionConflictError } from '../../domain/errors/conversion-conflict.error';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';
import { type VoiceId } from '../../domain/voices';
import { BillingQuotaAdapter } from '../billing/billing-quota.adapter';

import { DrizzleConversionRepository } from './conversion.drizzle-repository';

const AT = new Date('2026-10-06T10:00:00Z');
const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

function makeConversion(overrides: Partial<Conversion> = {}): Conversion {
  return {
    ...newQueuedConversion({
      id: ConversionId.of(uuidV7()),
      ownerId: 'alice',
      documentId: DOC,
      voiceId: 'fr-f1' as VoiceId,
      textRevision: 1,
      reservedChars: 1000,
      now: AT,
    }),
    ...overrides,
  };
}

const segments = (n: number): PreparedSegment[] =>
  Array.from({ length: n }, (_, index) => ({
    index,
    ssml: `<speak><mark name="w0"/>mot${String(index)}</speak>`,
    words: [{ t: `mot${String(index)}`, p: 1 }],
    charCount: 100,
    fingerprint: 'f'.repeat(64),
    partIndex: Math.floor(index / 10),
    firstWordIndex: index,
  }));

/** Plan des parties des segments ci-dessus : 10 segments par partie. */
const plan = (n: number) =>
  Array.from({ length: Math.ceil(n / 10) }, (_, index) => ({
    index,
    firstSegment: index * 10,
    lastSegment: Math.min(n, (index + 1) * 10) - 1,
  }));

const audio = { audioKey: 'tts-cache/x.mp3', timepoints: [0.1], durationMs: 480, cacheHit: false };

/**
 * Contre un vrai Postgres migré : index unique partiel, transitions
 * conditionnelles, et surtout l'**atomicité entre modules** (ADR-0010) — la
 * réservation de `billing` rejoint la transaction de `conversion` et
 * disparaît avec elle.
 */
describe('DrizzleConversionRepository (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let repo: DrizzleConversionRepository;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    repo = new DrizzleConversionRepository(pg.db);
    await pg.db.insert(user).values([{ id: 'alice', name: 'Alice', email: 'alice@x.cm' }]);
    await pg.db.insert(documents).values({
      id: DOC,
      ownerId: 'alice',
      title: 'Livre',
      status: 'text_ready',
      sizeBytes: 10,
      sourceKey: 'documents/alice/doc/source.pdf',
      rightsAttestedAt: AT,
      rightsAttestationVersion: 'v1',
      charCount: 1000,
      textRevision: 1,
      createdAt: AT,
      updatedAt: AT,
    });
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.sql`delete from conversions`;
    await pg.sql`delete from quota_reservations`;
    await pg.sql`delete from quota_usage`;
  });

  it('round-trips a conversion and filters by owner', async () => {
    const conversion = makeConversion();
    await repo.insert(conversion);
    expect(await repo.findById(conversion.id)).toEqual(conversion);
    expect(await repo.findByIdForOwner(conversion.id, 'bob')).toBeNull();
    expect(await repo.findActive(DOC, conversion.voiceId, 1)).toEqual(conversion);
    expect(await repo.findActive(DOC, conversion.voiceId, 2)).toBeNull();
  });

  it('allows one active conversion per (document, voice, revision), a new one after a failure', async () => {
    const first = makeConversion();
    await repo.insert(first);
    await expect(repo.insert(makeConversion())).rejects.toBeInstanceOf(ConversionConflictError);
    await repo.insert(makeConversion({ voiceId: 'fr-m1' as VoiceId }));
    await repo.markFailed(first.id, 'internal', AT);
    await expect(repo.insert(makeConversion())).resolves.toBeUndefined();
  });

  it('runs the pipeline transitions once each, and computes the refund on failure', async () => {
    const conversion = makeConversion();
    await repo.insert(conversion);
    expect(await repo.markPreparing(conversion.id, AT)).toBe(true);
    expect(await repo.completePreparation(conversion.id, segments(450), plan(450), AT)).toBe(true);
    expect(await repo.completePreparation(conversion.id, segments(3), plan(3), AT)).toBe(false);
    expect(await repo.findById(conversion.id)).toMatchObject({
      status: ConversionStatus.SYNTHESIZING,
      segmentCount: 450,
    });

    const later = new Date('2026-10-06T10:05:00Z');
    expect(await repo.completeSegment(conversion.id, 1, audio, later)).toBe(true);
    expect(await repo.completeSegment(conversion.id, 1, audio, later)).toBe(false);
    expect(await repo.countSynthesizedSegments(conversion.id)).toBe(1);
    const pending = await repo.listPendingSegmentIndexes(conversion.id);
    expect(pending.slice(0, 3)).toEqual([0, 2, 3]);
    expect(await repo.findSegment(conversion.id, 1)).toMatchObject({
      words: [{ t: 'mot1', p: 1 }],
      audio,
    });
    expect(await repo.findSegment(conversion.id, 0)).toMatchObject({ audio: null });
    expect(await repo.completeIfAllSegmentsSynthesized(conversion.id, later)).toBe(false);
    expect(await repo.findById(conversion.id)).toMatchObject({ updatedAt: later });

    expect(await repo.markFailed(conversion.id, 'internal', later)).toEqual({
      reservedChars: 1000,
      consumedChars: 100,
    });
    expect(await repo.markFailed(conversion.id, 'internal', later)).toBeNull();
  });

  it('completes the conversion when the last segment is synthesized', async () => {
    const conversion = makeConversion();
    await repo.insert(conversion);
    await repo.markPreparing(conversion.id, AT);
    await repo.completePreparation(conversion.id, segments(2), plan(2), AT);
    await repo.completeSegment(conversion.id, 0, audio, AT);
    await repo.completeSegment(conversion.id, 1, audio, AT);
    expect(await repo.completeIfAllSegmentsSynthesized(conversion.id, AT)).toBe(true);
    expect(await repo.completeIfAllSegmentsSynthesized(conversion.id, AT)).toBe(false);
    // `completedAt` attend le passage en `ready` (assemblage, ADR-0011).
    expect(await repo.findById(conversion.id)).toMatchObject({
      status: ConversionStatus.SYNTHESIZED,
      completedAt: null,
    });
    expect(await repo.markFailed(conversion.id, 'internal', AT)).toBeNull();
  });

  it('stores the part plan, finds assemblable parts, assembles once, then marks the conversion ready', async () => {
    const conversion = makeConversion();
    await repo.insert(conversion);
    await repo.markPreparing(conversion.id, AT);
    await repo.completePreparation(conversion.id, segments(15), plan(15), AT);
    expect(await repo.findById(conversion.id)).toMatchObject({ partCount: 2 });
    expect(await repo.listParts(conversion.id)).toEqual([
      expect.objectContaining({
        index: 0,
        firstSegment: 0,
        lastSegment: 9,
        firstWordIndex: 0,
        assembled: null,
      }),
      expect.objectContaining({
        index: 1,
        firstSegment: 10,
        lastSegment: 14,
        firstWordIndex: 10,
        assembled: null,
      }),
    ]);
    expect(await repo.findSegment(conversion.id, 12)).toMatchObject({
      partIndex: 1,
      firstWordIndex: 12,
    });

    for (let i = 10; i < 15; i += 1) await repo.completeSegment(conversion.id, i, audio, AT);
    expect(await repo.isPartSynthesized(conversion.id, 1)).toBe(true);
    expect(await repo.isPartSynthesized(conversion.id, 0)).toBe(false);
    expect(await repo.listAssemblablePartIndexes(conversion.id)).toEqual([1]);
    const partSegments = await repo.listPartSegments(conversion.id, 1);
    expect(partSegments.map((segment) => segment.index)).toEqual([10, 11, 12, 13, 14]);

    const assembled = {
      audio: { key: 'conversions/alice/c/part-002.mp3', bytes: 1200, sha256: 'a'.repeat(64) },
      vtt: { key: 'conversions/alice/c/part-002.vtt', bytes: 300, sha256: 'b'.repeat(64) },
      durationMs: 2400,
      wordCount: 5,
      pageStarts: [{ page: 2, wordIndex: 12 }],
    };
    const later = new Date('2026-10-06T10:10:00Z');
    expect(await repo.completePart(conversion.id, 1, assembled, later)).toBe(true);
    expect(await repo.completePart(conversion.id, 1, assembled, later)).toBe(false);
    expect(await repo.findPart(conversion.id, 1)).toMatchObject({ assembled });
    expect(await repo.countAssembledParts(conversion.id)).toBe(1);
    expect(await repo.listAssemblablePartIndexes(conversion.id)).toEqual([]);

    for (let i = 0; i < 10; i += 1) await repo.completeSegment(conversion.id, i, audio, later);
    await repo.completeIfAllSegmentsSynthesized(conversion.id, later);
    expect(await repo.markReadyIfAllPartsAssembled(conversion.id, later)).toBe(false); // partie 0 manquante
    await repo.completePart(conversion.id, 0, assembled, later);
    expect(await repo.markReadyIfAllPartsAssembled(conversion.id, later)).toBe(true);
    expect(await repo.findById(conversion.id)).toMatchObject({
      status: 'ready',
      completedAt: later,
    });
  });

  it('finds stalled conversions by status and age', async () => {
    const old = makeConversion();
    await repo.insert(old);
    await repo.insert(
      makeConversion({ voiceId: 'fr-m1' as VoiceId, updatedAt: new Date('2026-10-06T11:00:00Z') }),
    );
    expect(
      await repo.findStalled([ConversionStatus.QUEUED], new Date('2026-10-06T10:30:00Z'), 10),
    ).toEqual([{ id: old.id, status: 'queued' }]);
  });

  describe('cross-module transaction (ADR-0010, ADR-0019)', () => {
    /** Unités du palier gratuit prises par alice ce mois-ci. */
    async function freeUsed(): Promise<number> {
      const rows = await pg.sql<
        { reserved_chars: string }[]
      >`select reserved_chars from quota_usage where user_id = 'alice' and period = '2026-10'`;
      return Number(rows.at(0)?.reserved_chars ?? 0);
    }

    function startUseCase(freeTier: number) {
      const uow = new DrizzleUnitOfWork(pg.db);
      const clock = new FixedClock(AT);
      const ledger = new DrizzleUnitsLedger(pg.db);
      const policy = { freeTierUnitsPerMonth: freeTier, maxCharsPerConversion: 1_000_000 };
      const quota = new BillingQuotaAdapter(
        new ReserveQuotaUseCase(ledger, policy, uow, clock),
        new RefundQuotaUseCase(ledger, uow, clock),
      );
      const source = new FakeDocumentTextSource();
      source.add(
        {
          documentId: DOC,
          ownerId: 'alice',
          textReady: true,
          status: 'text_ready',
          charCount: 1000,
          textRevision: 1,
        },
        [],
      );
      return {
        start: new StartConversionUseCase(
          repo,
          source,
          quota,
          new FakeConversionJobs(),
          uow,
          clock,
        ),
        fail: new FailConversionUseCase(repo, quota, uow, clock),
      };
    }

    it('writes the conversion and its reservation together', async () => {
      const { start } = startUseCase(5000);
      const result = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(result.isOk()).toBe(true);
      expect(await freeUsed()).toBe(1000);
      const [reservation] = await pg.sql<
        { reservation_id: string }[]
      >`select reservation_id from quota_reservations`;
      expect(reservation.reservation_id).toBe(result.value.id);
    });

    it('rolls the reservation back when the conversion insert loses the race', async () => {
      const { start } = startUseCase(5000);
      const winner = await start.execute({ ownerId: 'alice', documentId: DOC });
      // Le perdant ne voit pas la conversion gagnante (course), et son insertion est refusée.
      const findActive = jest.spyOn(repo, 'findActive').mockResolvedValueOnce(null);
      const loser = await start.execute({ ownerId: 'alice', documentId: DOC });
      findActive.mockRestore();
      expect(loser.value.id).toBe(winner.value.id);
      expect(await freeUsed()).toBe(1000); // un seul débit
      const [{ count }] = await pg.sql<
        { count: string }[]
      >`select count(*) from quota_reservations`;
      expect(Number(count)).toBe(1);
    });

    it('creates nothing when the quota is exhausted', async () => {
      const { start } = startUseCase(500);
      const result = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(result.error).toMatchObject({
        code: 'QUOTA_EXCEEDED',
        details: { requested: 1000, usable: 500 },
      });
      const [{ count }] = await pg.sql<{ count: string }[]>`select count(*) from conversions`;
      expect(Number(count)).toBe(0);
    });

    it('fails and refunds in one transaction, once', async () => {
      const { start, fail } = startUseCase(5000);
      const { value } = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(await fail.execute(value.id, 'internal')).toBe(true);
      expect(await fail.execute(value.id, 'internal')).toBe(false);
      expect(await freeUsed()).toBe(0);
    });
  });
});
