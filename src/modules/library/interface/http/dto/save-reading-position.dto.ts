import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsISO8601, Max, Min } from 'class-validator';

/** Plafond d'un entier SQL `integer` : borne de transport, le domaine fait le reste. */
const INT32_MAX = 2_147_483_647;

/**
 * Corps de `PUT /v1/conversions/:id/position`. Le DTO valide la forme ; les
 * bornes réelles (mots et durée écoutables, horloge) sont dans le domaine et
 * renvoient 422 `INVALID_READING_POSITION`.
 */
export class SaveReadingPositionDto {
  @ApiProperty({ description: 'Index global du mot (identifiant de cue WebVTT)', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(INT32_MAX)
  wordIndex!: number;

  @ApiProperty({
    description: "Position dans l'audio, en millisecondes depuis le début du livre",
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @Max(INT32_MAX)
  audioMs!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: "Instant de l'interruption SUR L'APPAREIL (départage plusieurs appareils)",
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  recordedAt!: string;
}
