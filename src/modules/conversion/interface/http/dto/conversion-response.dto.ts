import { ApiProperty } from '@nestjs/swagger';

import {
  ConversionFailureReason,
  ConversionStatus,
} from '@/modules/conversion/domain/value-objects/conversion-status.vo';

export class ConversionProgressDto {
  @ApiProperty({ description: 'Segments synthétisés' })
  segmentsDone!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Nombre total de segments, connu une fois la préparation terminée',
  })
  segmentCount!: number | null;

  @ApiProperty({ description: 'Parties écoutables (la partie 1 = aperçu)' })
  partsReady!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Nombre total de parties' })
  partCount!: number | null;
}

/** Représentation HTTP d'une conversion. Les clés de stockage ne sont jamais exposées. */
export class ConversionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'fr-f1' })
  voiceId!: string;

  @ApiProperty({ enum: Object.values(ConversionStatus) })
  status!: ConversionStatus;

  @ApiProperty({ description: 'Caractères réservés sur le quota (remboursés en cas d’échec)' })
  reservedChars!: number;

  @ApiProperty({ type: ConversionProgressDto })
  progress!: ConversionProgressDto;

  @ApiProperty({
    enum: Object.values(ConversionFailureReason),
    nullable: true,
    description: 'Raison stable quand status = failed',
  })
  failureReason!: ConversionFailureReason | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
}
