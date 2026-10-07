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

  @ApiProperty()
  isDefault!: boolean;
}

export class VoiceListResponseDto {
  @ApiProperty({ type: [VoiceDto] })
  items!: VoiceDto[];
}
