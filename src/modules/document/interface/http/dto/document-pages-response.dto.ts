import { ApiProperty } from '@nestjs/swagger';

/** Texte d'une page du livre, pour l'écran de validation (RF-06). */
export class DocumentPageTextDto {
  @ApiProperty({ minimum: 1 })
  pageNumber!: number;

  @ApiProperty({ description: 'Lignes séparées par des sauts de ligne' })
  text!: string;

  @ApiProperty()
  charCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class DocumentPagesResponseDto {
  @ApiProperty({ type: [DocumentPageTextDto] })
  items!: DocumentPageTextDto[];

  @ApiProperty({ type: String, nullable: true, description: '`null` en fin de document' })
  nextCursor!: string | null;
}
