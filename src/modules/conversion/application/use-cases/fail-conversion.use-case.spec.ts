import {
  FakeQuota,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryConversionRepository,
} from '../../../../../test/support/fakes';
import { newQueuedConversion } from '../../domain/entities/conversion.entity';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import {
  ConversionFailureReason,
  ConversionStatus,
} from '../../domain/value-objects/conversion-status.vo';
import { type VoiceId } from '../../domain/voices';

import { FailConversionUseCase } from './fail-conversion.use-case';

const ID = ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c');
const NOW = new Date('2026-10-06T10:00:00Z');

async function setup() {
  const repo = new InMemoryConversionRepository();
  await repo.insert(
    newQueuedConversion({
      id: ID,
      ownerId: 'alice',
      documentId: 'doc',
      voiceId: 'fr-f1' as VoiceId,
      textRevision: 1,
      reservedChars: 1000,
      now: NOW,
    }),
  );
  await repo.markPreparing(ID, NOW);
  await repo.completePreparation(
    ID,
    [0, 1].map((index) => ({ index, ssml: 's', words: [], charCount: 300, fingerprint: 'f' })),
    NOW,
  );
  const quota = new FakeQuota();
  const sut = new FailConversionUseCase(
    repo,
    quota,
    new ImmediateUnitOfWork(),
    new FixedClock(NOW),
  );
  return { sut, repo, quota };
}

describe('FailConversionUseCase', () => {
  it('fails the conversion and refunds what was not synthesized, once', async () => {
    const { sut, repo, quota } = await setup();
    await repo.completeSegment(
      ID,
      0,
      { audioKey: 'k', timepoints: [], durationMs: 1, cacheHit: false },
      NOW,
    );
    expect(await sut.execute(ID, ConversionFailureReason.INTERNAL)).toBe(true);
    expect(await sut.execute(ID, ConversionFailureReason.INTERNAL)).toBe(false);
    expect(repo.rows.get(ID)).toMatchObject({
      status: ConversionStatus.FAILED,
      failureReason: 'internal',
    });
    expect(quota.refunds).toEqual([{ reservationId: ID, chars: 700 }]);
  });
});
