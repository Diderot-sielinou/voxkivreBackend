import { newQueuedConversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';

import { toConversionProgressDto, toVoiceListResponseDto } from './conversion.mapper';

const NOW = new Date('2026-10-06T10:00:00.000Z');

describe('conversion mappers', () => {
  it('exposes ISO dates and progress, never the owner nor storage keys', () => {
    const conversion = newQueuedConversion({
      id: ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c'),
      ownerId: 'alice',
      documentId: 'doc',
      voiceId: 'fr-f1' as VoiceId,
      textRevision: 1,
      reservedChars: 1200,
      now: NOW,
    });
    const dto = toConversionProgressDto({ conversion, segmentsDone: 0 });
    expect(dto).toEqual({
      id: conversion.id,
      documentId: 'doc',
      voiceId: 'fr-f1',
      status: 'queued',
      reservedChars: 1200,
      progress: { segmentsDone: 0, segmentCount: null },
      failureReason: null,
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
      completedAt: null,
    });
    expect(Object.keys(dto)).not.toContain('ownerId');
    const done = toConversionProgressDto({
      conversion: { ...conversion, completedAt: NOW, segmentCount: 3 },
      segmentsDone: 3,
    });
    expect(done).toMatchObject({
      completedAt: '2026-10-06T10:00:00.000Z',
      progress: { segmentsDone: 3, segmentCount: 3 },
    });
  });

  it('maps the voice list', () => {
    expect(
      toVoiceListResponseDto([
        {
          id: 'fr-f1' as VoiceId,
          label: 'F',
          gender: 'female',
          languageCode: 'fr-FR',
          isDefault: true,
        },
      ]),
    ).toEqual({
      items: [
        { id: 'fr-f1', label: 'F', gender: 'female', languageCode: 'fr-FR', isDefault: true },
      ],
    });
  });
});
