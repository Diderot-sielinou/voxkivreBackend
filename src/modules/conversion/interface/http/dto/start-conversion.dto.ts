import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartConversionDto {
  @ApiPropertyOptional({
    description: 'Identifiant de voix (GET /v1/voices) ; voix par défaut si absent',
    example: 'fr-f1',
  })
  @IsOptional()
  @IsString()
  // Borne de transport : le domaine vérifie la liste blanche.
  @MaxLength(32)
  voiceId?: string;
}
