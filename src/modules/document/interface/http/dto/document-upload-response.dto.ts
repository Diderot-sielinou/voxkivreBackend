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

export class DocumentUploadResponseDto {
  @ApiProperty({ type: DocumentResponseDto })
  document!: DocumentResponseDto;

  @ApiProperty({ type: UploadInstructionsDto })
  upload!: UploadInstructionsDto;
}
