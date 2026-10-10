import { Inject, Injectable } from '@nestjs/common';

import { Result } from '@/shared/kernel';

import { type ReadingPosition } from '../../domain/entities/reading-position.entity';
import { ReadingPositionNotFoundError } from '../../domain/errors/reading-position-not-found.error';
import {
  READING_POSITION_REPOSITORY,
  type ReadingPositionRepositoryPort,
} from '../../domain/ports/reading-position-repository.port';

/**
 * `GET /v1/conversions/:id/position` (RF-20) : où reprendre. 404 si la
 * lecture n'a jamais commencé — ou si la conversion n'est pas à
 * l'utilisateur (même réponse, RNF-08).
 */
@Injectable()
export class GetReadingPositionUseCase {
  constructor(
    @Inject(READING_POSITION_REPOSITORY) private readonly positions: ReadingPositionRepositoryPort,
  ) {}

  async execute(input: {
    readonly ownerId: string;
    readonly conversionId: string;
  }): Promise<Result<ReadingPosition, ReadingPositionNotFoundError>> {
    const position = await this.positions.findForOwner(input.conversionId, input.ownerId);
    return position === null
      ? Result.err(new ReadingPositionNotFoundError(input.conversionId))
      : Result.ok(position);
  }
}
