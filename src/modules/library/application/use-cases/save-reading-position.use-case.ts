import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { ConversionNotFoundError } from '../../domain/errors/conversion-not-found.error';
import { ConversionNotReadyError } from '../../domain/errors/conversion-not-ready.error';
import {
  LIBRARY_CONVERSIONS,
  type LibraryConversionsPort,
} from '../../domain/ports/library-conversions.port';
import {
  READING_POSITION_REPOSITORY,
  type ReadingPositionRepositoryPort,
  type SavedReadingPosition,
} from '../../domain/ports/reading-position-repository.port';
import { validateReadingPosition } from '../../domain/services/reading-position-policy';

export interface SaveReadingPositionInput {
  readonly ownerId: string;
  readonly conversionId: string;
  readonly wordIndex: number;
  readonly audioMs: number;
  readonly recordedAt: Date;
}

/**
 * `PUT /v1/conversions/:id/position` (RF-19, ADR-0015) : enregistre la
 * position si elle est plus récente que celle connue — un appareil resté
 * hors-ligne n'écrase pas la lecture faite depuis sur un autre. Rejouer la
 * même requête est sans effet (`applied: false`).
 */
@Injectable()
export class SaveReadingPositionUseCase {
  constructor(
    @Inject(LIBRARY_CONVERSIONS) private readonly conversions: LibraryConversionsPort,
    @Inject(READING_POSITION_REPOSITORY) private readonly positions: ReadingPositionRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(
    input: SaveReadingPositionInput,
  ): Promise<Result<SavedReadingPosition, DomainError>> {
    const conversion = await this.conversions.findForOwner(input.conversionId, input.ownerId);
    if (conversion === null) return Result.err(new ConversionNotFoundError(input.conversionId));
    if (conversion.playableWordCount === 0) {
      return Result.err(new ConversionNotReadyError(input.conversionId, conversion.status));
    }

    const now = this.clock.now();
    const valid = validateReadingPosition(input, conversion, now);
    if (valid.isErr()) return Result.err(valid.error);

    return Result.ok(
      await this.positions.saveIfNewer({
        conversionId: input.conversionId,
        ownerId: input.ownerId,
        wordIndex: input.wordIndex,
        audioMs: input.audioMs,
        recordedAt: input.recordedAt,
        updatedAt: now,
      }),
    );
  }
}
