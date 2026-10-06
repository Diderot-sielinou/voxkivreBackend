import { ApiProperty } from '@nestjs/swagger';

/** Quota en caractères du mois en cours (RF-24). */
export class QuotaResponseDto {
  @ApiProperty({ example: '2026-10', description: 'Mois civil UTC' })
  period!: string;

  @ApiProperty({ description: 'Caractères disponibles ce mois-ci' })
  limit!: number;

  @ApiProperty({ description: 'Caractères réservés par les conversions lancées' })
  used!: number;

  @ApiProperty()
  remaining!: number;

  @ApiProperty({ description: "Plafond d'une seule conversion (RNF-25)" })
  maxCharsPerConversion!: number;
}
