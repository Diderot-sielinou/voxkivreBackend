import { ApiProperty } from '@nestjs/swagger';

/** Une entrée de la table des matières (RF-12, ADR-0027). */
export class OutlineEntryDto {
  @ApiProperty({ example: '3.1. Residual Learning' })
  title!: string;

  @ApiProperty({ minimum: 1, maximum: 3, description: '1 = plus haut niveau' })
  level!: number;

  @ApiProperty({
    minimum: 1,
    description:
      "Page du titre. L'app cherche les mots du titre dans les mots de cette page " +
      '(manifeste de la conversion) ; à défaut, elle saute au début de la page.',
  })
  pageNumber!: number;
}

export class DocumentOutlineResponseDto {
  @ApiProperty({ type: [OutlineEntryDto] })
  items!: OutlineEntryDto[];

  @ApiProperty({
    enum: ['bookmarks', 'headings'],
    nullable: true,
    description:
      'bookmarks : signets du PDF ; headings : titres détectés par leur police ; ' +
      'null : document extrait avant la table des matières (liste vide)',
  })
  source!: 'bookmarks' | 'headings' | null;
}
