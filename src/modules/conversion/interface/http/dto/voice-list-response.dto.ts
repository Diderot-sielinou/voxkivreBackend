import { ApiProperty } from '@nestjs/swagger';

export class VoiceDto {
  @ApiProperty({ example: 'fr-f1' })
  id!: string;

  @ApiProperty({ example: 'Voix féminine naturelle' })
  label!: string;

  @ApiProperty({ enum: ['female', 'male'] })
  gender!: 'female' | 'male';

  @ApiProperty({ example: 'fr-FR' })
  languageCode!: string;

  @ApiProperty({
    enum: ['standard', 'natural'],
    description:
      'Gamme : une voix naturelle coûte 4 unités par caractère, une standard 1 (GET /v1/billing/offers) ; le palier gratuit ne finance que les voix standard (ADR-0019).',
  })
  tier!: 'standard' | 'natural';

  @ApiProperty()
  isDefault!: boolean;
}

export class VoiceListResponseDto {
  @ApiProperty({ type: [VoiceDto] })
  items!: VoiceDto[];
}
