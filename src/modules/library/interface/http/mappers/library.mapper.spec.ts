import {
  ConversionState,
  DocumentState,
  LibraryItemStatus,
} from '../../../domain/value-objects/library-item-status.vo';

import { toLibraryListResponseDto, toSavedReadingPositionDto } from './library.mapper';

const AT = new Date('2026-10-10T10:00:00Z');
const position = {
  conversionId: 'c1',
  ownerId: 'alice',
  wordIndex: 10,
  audioMs: 1000,
  recordedAt: AT,
  updatedAt: AT,
};

describe('library mapper', () => {
  it('maps items to DTOs without leaking internal fields (owner, state)', () => {
    const dto = toLibraryListResponseDto({
      items: [
        {
          document: {
            documentId: 'd1',
            title: 'Livre',
            status: 'text_ready',
            state: DocumentState.TEXT_READY,
            pageCount: 3,
            charCount: 50,
            extractionError: null,
            createdAt: AT,
          },
          conversion: {
            conversionId: 'c1',
            documentId: 'd1',
            voiceId: 'fr-f1',
            status: 'ready',
            state: ConversionState.READY,
            failureReason: null,
            partCount: 1,
            partsReady: 1,
            playableWordCount: 100,
            playableDurationMs: 6000,
            completedAt: AT,
          },
          position,
          status: LibraryItemStatus.IN_PROGRESS,
          progressPercent: 11,
        },
        {
          document: {
            documentId: 'd2',
            title: 'Autre',
            status: 'extracting',
            state: DocumentState.PROCESSING,
            pageCount: null,
            charCount: null,
            extractionError: null,
            createdAt: AT,
          },
          conversion: null,
          position: null,
          status: LibraryItemStatus.PROCESSING,
          progressPercent: null,
        },
      ],
      nextCursor: null,
    });

    expect(dto.items[0]).toEqual({
      status: 'in_progress',
      progressPercent: 11,
      document: {
        id: 'd1',
        title: 'Livre',
        status: 'text_ready',
        pageCount: 3,
        charCount: 50,
        extractionError: null,
        createdAt: AT.toISOString(),
      },
      conversion: {
        id: 'c1',
        status: 'ready',
        voiceId: 'fr-f1',
        failureReason: null,
        partCount: 1,
        partsReady: 1,
        playableDurationMs: 6000,
        completedAt: AT.toISOString(),
      },
      position: {
        conversionId: 'c1',
        wordIndex: 10,
        audioMs: 1000,
        recordedAt: AT.toISOString(),
        updatedAt: AT.toISOString(),
      },
    });
    expect(dto.items[1]).toMatchObject({ conversion: null, position: null });
  });

  it('tells the device whether its position was applied', () => {
    expect(toSavedReadingPositionDto({ position, applied: false })).toMatchObject({
      wordIndex: 10,
      applied: false,
    });
  });
});
