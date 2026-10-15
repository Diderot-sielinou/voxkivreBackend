import { ApiProperty } from '@nestjs/swagger';

import { DocumentResponseDto } from './document-response.dto';

/** Instruction d'upload direct vers le stockage objet. */
export class UploadInstructionsDto {
  @ApiProperty({ description: 'URL signée, à appeler telle quelle' })
  url!: string;

  @ApiProperty({ enum: ['PUT'] })
  method!: 'PUT';

  @ApiProperty({
    description: 'En-têtes à envoyer tels quels (signés : toute autre valeur est refusée)',
    example: { 'content-type': 'application/pdf', 'content-length': '1048576' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  headers!: Record<string, string>;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

/** Envoi par morceaux (ADR-0029) : URL demandées ensuite à `upload-parts`. */
export class MultipartPlanDto {
  @ApiProperty({
    description: 'Taille d’un morceau en octets (le dernier : le reste)',
    example: 5_242_880,
  })
  partSize!: number;

  @ApiProperty({ example: 10 })
  partCount!: number;
}

export class DocumentUploadResponseDto {
  @ApiProperty({ type: DocumentResponseDto })
  document!: DocumentResponseDto;

  @ApiProperty({
    type: UploadInstructionsDto,
    nullable: true,
    description: 'Envoi en un seul PUT ; `null` pour un envoi par morceaux',
  })
  upload!: UploadInstructionsDto | null;

  @ApiProperty({
    type: MultipartPlanDto,
    nullable: true,
    description: 'Envoi par morceaux (demandé par `multipart: true`, fichier > 5 Mio)',
  })
  multipart!: MultipartPlanDto | null;
}

export class UploadPartInstructionsDto {
  @ApiProperty({ example: 3 })
  partNumber!: number;

  @ApiProperty({ description: 'URL signée, à appeler telle quelle' })
  url!: string;

  @ApiProperty({ enum: ['PUT'] })
  method!: 'PUT';

  @ApiProperty({
    description: 'En-têtes à envoyer tels quels (taille du morceau signée)',
    example: { 'content-length': '5242880' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  headers!: Record<string, string>;
}

export class UploadPartsResponseDto {
  @ApiProperty({ type: [Number], description: 'Morceaux déjà reçus : rien à renvoyer' })
  receivedParts!: number[];

  @ApiProperty({ type: [UploadPartInstructionsDto], description: 'Un PUT par morceau manquant' })
  parts!: UploadPartInstructionsDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}
