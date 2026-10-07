import { ConversionId } from '../value-objects/conversion-id.vo';
import { type VoiceId } from '../voices';

import { newQueuedConversion } from './conversion.entity';

describe('newQueuedConversion', () => {
  it('creates a queued conversion with exactly the entity fields', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    expect(
      newQueuedConversion({
        id: ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c'),
        ownerId: 'alice',
        documentId: 'doc',
        voiceId: 'fr-f1' as VoiceId,
        textRevision: 2,
        reservedChars: 10,
        now,
      }),
    ).toStrictEqual({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      ownerId: 'alice',
      documentId: 'doc',
      voiceId: 'fr-f1',
      textRevision: 2,
      reservedChars: 10,
      status: 'queued',
      segmentCount: null,
      partCount: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  });
});
