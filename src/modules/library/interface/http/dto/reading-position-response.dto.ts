import { ApiProperty } from '@nestjs/swagger';

export class ReadingPositionResponseDto {
  @ApiProperty({ format: 'uuid' })
  conversionId!: string;

  @ApiProperty()
  wordIndex!: number;

  @ApiProperty()
  audioMs!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class SavedReadingPositionResponseDto extends ReadingPositionResponseDto {
  @ApiProperty({
    description:
      '`false` : une position plus récente (autre appareil) était déjà enregistrée — reprendre à celle renvoyée',
  })
  applied!: boolean;
}
