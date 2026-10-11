import { ApiProperty } from '@nestjs/swagger';

import { SetAsideReason } from '@/modules/document/domain/services/text-cleaning';

/** Ligne retirée du texte lu par le nettoyage automatique (ADR-0022). */
export class SetAsideLineDto {
  @ApiProperty({ example: 'Université de Yaoundé II — Droit des obligations' })
  text!: string;

  @ApiProperty({ enum: Object.values(SetAsideReason) })
  reason!: SetAsideReason;
}

/** Texte d'une page du livre, pour l'écran de validation (RF-06). */
export class DocumentPageTextDto {
  @ApiProperty({ minimum: 1 })
  pageNumber!: number;

  @ApiProperty({ description: 'Lignes séparées par des sauts de ligne' })
  text!: string;

  @ApiProperty()
  charCount!: number;

  @ApiProperty({
    type: [SetAsideLineDto],
    description:
      'Lignes retirées du texte lu (en-têtes, pieds, numéros de page, notes, légendes). ' +
      'Pour en réintégrer une, corriger le texte de la page.',
  })
  setAside!: SetAsideLineDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class DocumentPagesResponseDto {
  @ApiProperty({ type: [DocumentPageTextDto] })
  items!: DocumentPageTextDto[];

  @ApiProperty({ type: String, nullable: true, description: '`null` en fin de document' })
  nextCursor!: string | null;
}
