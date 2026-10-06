import { RefundQuotaUseCase } from '@/modules/billing/application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '@/modules/billing/application/use-cases/reserve-quota.use-case';
import { DrizzleQuotaLedger } from '@/modules/billing/infrastructure/persistence/quota-ledger.drizzle-repository';
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
    expect(await repo.completePreparation(conversion.id, segments(450), AT)).toBe(true);
    expect(await repo.completePreparation(conversion.id, segments(3), AT)).toBe(false);
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
    await repo.completePreparation(conversion.id, segments(2), AT);
    await repo.completeSegment(conversion.id, 0, audio, AT);
    await repo.completeSegment(conversion.id, 1, audio, AT);
    expect(await repo.completeIfAllSegmentsSynthesized(conversion.id, AT)).toBe(true);
    expect(await repo.completeIfAllSegmentsSynthesized(conversion.id, AT)).toBe(false);
    expect(await repo.findById(conversion.id)).toMatchObject({
      status: ConversionStatus.SYNTHESIZED,
      completedAt: AT,
    });
    expect(await repo.markFailed(conversion.id, 'internal', AT)).toBeNull();
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

  describe('cross-module transaction (ADR-0010)', () => {
    function startUseCase(freeTier: number) {
      const uow = new DrizzleUnitOfWork(pg.db);
      const clock = new FixedClock(AT);
      const ledger = new DrizzleQuotaLedger(pg.db);
      const policy = { freeTierCharsPerMonth: freeTier, maxCharsPerConversion: 1_000_000 };
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
        ledger,
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
      const { start, ledger } = startUseCase(5000);
      const result = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(result.isOk()).toBe(true);
      expect(await ledger.usage('alice', '2026-10' as never)).toBe(1000);
      const [reservation] = await pg.sql<
        { reservation_id: string }[]
      >`select reservation_id from quota_reservations`;
      expect(reservation.reservation_id).toBe(result.value.id);
    });

    it('rolls the reservation back when the conversion insert loses the race', async () => {
      const { start, ledger } = startUseCase(5000);
      const winner = await start.execute({ ownerId: 'alice', documentId: DOC });
      // Le perdant ne voit pas la conversion gagnante (course), et son insertion est refusée.
      const findActive = jest.spyOn(repo, 'findActive').mockResolvedValueOnce(null);
      const loser = await start.execute({ ownerId: 'alice', documentId: DOC });
      findActive.mockRestore();
      expect(loser.value.id).toBe(winner.value.id);
      expect(await ledger.usage('alice', '2026-10' as never)).toBe(1000); // un seul débit
      const [{ count }] = await pg.sql<
        { count: string }[]
      >`select count(*) from quota_reservations`;
      expect(Number(count)).toBe(1);
    });

    it('creates nothing when the quota is exhausted', async () => {
      const { start } = startUseCase(500);
      const result = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(result.error).toMatchObject({ code: 'QUOTA_EXCEEDED', details: { remaining: 500 } });
      const [{ count }] = await pg.sql<{ count: string }[]>`select count(*) from conversions`;
      expect(Number(count)).toBe(0);
    });

    it('fails and refunds in one transaction, once', async () => {
      const { start, fail, ledger } = startUseCase(5000);
      const { value } = await start.execute({ ownerId: 'alice', documentId: DOC });
      expect(await fail.execute(value.id, 'internal')).toBe(true);
      expect(await fail.execute(value.id, 'internal')).toBe(false);
      expect(await ledger.usage('alice', '2026-10' as never)).toBe(0);
    });
  });
});
