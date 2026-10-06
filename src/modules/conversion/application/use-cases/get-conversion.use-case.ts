import { Inject, Injectable } from '@nestjs/common';

import { type DomainError, Result } from '@/shared/kernel';

import { type Conversion } from '../../domain/entities/conversion.entity';
import { ConversionNotFoundError } from '../../domain/errors/conversion-not-found.error';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';

export interface ConversionProgress {
  readonly conversion: Conversion;
  /** Segments synthétisés (à rapporter à `conversion.segmentCount`). */
  readonly segmentsDone: number;
}

/** `GET /v1/conversions/:id` : statut et progression, suivis par le mobile (polling). */
@Injectable()
export class GetConversionUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
  ) {}

  async execute(input: {
    readonly ownerId: string;
    readonly conversionId: ConversionId;
  }): Promise<Result<ConversionProgress, DomainError>> {
    const conversion = await this.conversions.findByIdForOwner(input.conversionId, input.ownerId);
    if (conversion === null) return Result.err(new ConversionNotFoundError(input.conversionId));
    const segmentsDone =
      conversion.segmentCount === null
        ? 0
        : await this.conversions.countSynthesizedSegments(conversion.id);
    return Result.ok({ conversion, segmentsDone });
  }
}
