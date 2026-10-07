import { newQueuedConversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';

import {
  toConversionManifestResponseDto,
  toConversionProgressDto,
  toVoiceListResponseDto,
} from './conversion.mapper';

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
    const dto = toConversionProgressDto({ conversion, segmentsDone: 0, partsReady: 0 });
    expect(dto).toEqual({
      id: conversion.id,
      documentId: 'doc',
      voiceId: 'fr-f1',
      status: 'queued',
      reservedChars: 1200,
      progress: { segmentsDone: 0, segmentCount: null, partsReady: 0, partCount: null },
      failureReason: null,
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
      completedAt: null,
    });
    expect(Object.keys(dto)).not.toContain('ownerId');
    const done = toConversionProgressDto({
      conversion: { ...conversion, completedAt: NOW, segmentCount: 3, partCount: 1 },
      segmentsDone: 3,
      partsReady: 1,
    });
    expect(done).toMatchObject({
      completedAt: '2026-10-06T10:00:00.000Z',
      progress: { segmentsDone: 3, segmentCount: 3, partsReady: 1, partCount: 1 },
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

describe('manifest mapper', () => {
  it('adds the signed URL of each ready file and never exposes storage keys', () => {
    const dto = toConversionManifestResponseDto({
      manifest: {
        version: 1,
        conversionId: 'c',
        documentId: 'd',
        voiceId: 'fr-f1',
        textRevision: 1,
        complete: false,
        durationMs: null,
        partCount: 2,
        parts: [
          {
            index: 0,
            status: 'ready',
            firstWordIndex: 0,
            durationMs: 1000,
            startMs: 0,
            wordCount: 3,
            pageStarts: [{ page: 1, wordIndex: 0 }],
            audio: { name: 'part-001.mp3', bytes: 10, sha256: 'a' },
            vtt: { name: 'part-001.vtt', bytes: 5, sha256: 'b' },
          },
          {
            index: 1,
            status: 'pending',
            firstWordIndex: 3,
            durationMs: null,
            startMs: null,
            wordCount: null,
            pageStarts: [],
            audio: null,
            vtt: null,
          },
        ],
      },
      urls: new Map([['part-001.mp3', 'https://signed/mp3']]),
      urlsExpireAt: NOW,
    });
    expect(dto.urlsExpireAt).toBe('2026-10-06T10:00:00.000Z');
    expect(dto.parts[0].audio).toEqual({
      name: 'part-001.mp3',
      bytes: 10,
      sha256: 'a',
      url: 'https://signed/mp3',
    });
    expect(dto.parts[0].vtt?.url).toBeNull();
    expect(dto.parts[1]).toMatchObject({ status: 'pending', audio: null, vtt: null });
    expect(JSON.stringify(dto)).not.toContain('conversions/');
  });
});
