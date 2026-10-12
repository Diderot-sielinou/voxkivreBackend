import { ApiProperty } from '@nestjs/swagger';

import {
  DocumentStatus,
  ExtractionFailureReason,
  ExtractionMethod,
} from '@/modules/document/domain/value-objects/document-status.vo';

/** Avancement d'un OCR (ADR-0024). */
export class OcrProgressDto {
  @ApiProperty({ description: 'Pages déjà reconnues' })
  done!: number;

  @ApiProperty({ description: 'Pages à reconnaître' })
  total!: number;
}

/** Représentation HTTP d'un document. La clé de stockage interne n'est jamais exposée. */
export class DocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: Object.values(DocumentStatus) })
  status!: DocumentStatus;

  @ApiProperty({ description: 'Taille en octets' })
  sizeBytes!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  rightsAttestedAt!: string;

  @ApiProperty({ example: 'v1', description: "Version du texte d'attestation accepté" })
  rightsAttestationVersion!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  uploadedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Renseigné en text_ready' })
  pageCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Caractères du texte (base du quota, RF-24) ; renseigné en text_ready',
  })
  charCount!: number | null;

  @ApiProperty({
    enum: Object.values(ExtractionFailureReason),
    nullable: true,
    description: 'Raison stable quand status = extraction_failed',
  })
  extractionError!: ExtractionFailureReason | null;

  @ApiProperty({
    enum: Object.values(ExtractionMethod),
    nullable: true,
    description: 'native : couche texte du PDF ; ocr : PDF scanné reconnu (ADR-0024)',
  })
  extractionMethod!: ExtractionMethod | null;

  @ApiProperty({
    type: OcrProgressDto,
    nullable: true,
    description: 'Pendant un OCR, sur GET /v1/documents/:id seulement',
  })
  ocrProgress!: OcrProgressDto | null;

  @ApiProperty({
    description:
      'Confiance OCR faible sur au moins une page : la relecture est imposée avant la ' +
      'conversion (RF-06, POST /v1/documents/:id/review)',
  })
  reviewRequired!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
