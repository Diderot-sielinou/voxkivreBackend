import { ApiProperty } from '@nestjs/swagger';

import { LibraryItemStatus } from '@/modules/library/domain/value-objects/library-item-status.vo';

import { ReadingPositionResponseDto } from './reading-position-response.dto';

export class LibraryDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Statut du document (cf. GET /v1/documents/:id)' })
  status!: string;

  @ApiProperty({ type: Number, nullable: true })
  pageCount!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  charCount!: number | null;

  @ApiProperty({ type: String, nullable: true })
  extractionError!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class LibraryConversionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Statut de la conversion (cf. GET /v1/conversions/:id)' })
  status!: string;

  @ApiProperty()
  voiceId!: string;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  partCount!: number | null;

  @ApiProperty()
  partsReady!: number;

  @ApiProperty({ description: 'Durée écoutable depuis le début (ms)' })
  playableDurationMs!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
}

export class LibraryItemDto {
  @ApiProperty({ enum: Object.values(LibraryItemStatus) })
  status!: LibraryItemStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Progression 0–100, seulement quand la conversion est complète',
  })
  progressPercent!: number | null;

  @ApiProperty({ type: LibraryDocumentDto })
  document!: LibraryDocumentDto;

  @ApiProperty({ type: LibraryConversionDto, nullable: true })
  conversion!: LibraryConversionDto | null;

  @ApiProperty({ type: ReadingPositionResponseDto, nullable: true })
  position!: ReadingPositionResponseDto | null;
}

export class LibraryListResponseDto {
  @ApiProperty({ type: [LibraryItemDto] })
  items!: LibraryItemDto[];

  @ApiProperty({ type: String, nullable: true, description: '`null` en fin de liste' })
  nextCursor!: string | null;
}
