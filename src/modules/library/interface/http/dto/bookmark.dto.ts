import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsString, Max, MaxLength, Min } from 'class-validator';

/** Plafond d'un entier SQL `integer` : borne de transport, le domaine fait le reste. */
const INT32_MAX = 2_147_483_647;
/**
 * Borne de transport de la note, au-dessus de la limite métier (2 000,
 * 422 `INVALID_BOOKMARK_NOTE`) : protège seulement contre un corps énorme.
 */
const NOTE_TRANSPORT_MAX = 20_000;

/**
 * Corps de `PUT /v1/documents/:id/bookmarks/:bookmarkId` (ADR-0028). La forme
 * est validée ici ; l'ancrage, la note et l'horloge le sont par le domaine.
 */
export class PutBookmarkDto {
  @ApiProperty({ minimum: 1, description: 'Page du mot marqué (1-based)' })
  @IsInt()
  @Min(1)
  @Max(INT32_MAX)
  pageNumber!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'Index du mot dans la page (0 = premier). Index global dans une conversion : ' +
      'pageStarts[page].wordIndex + wordIndex (manifeste, ADR-0011).',
  })
  @IsInt()
  @Min(0)
  @Max(INT32_MAX)
  wordIndex!: number;

  @ApiProperty({ maxLength: 2000, description: 'Note de l’utilisateur (peut être vide)' })
  @IsString()
  @MaxLength(NOTE_TRANSPORT_MAX)
  note!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: "Instant de la modification SUR L'APPAREIL : le plus récent gagne",
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  updatedAt!: string;
}

/** Requête de `DELETE /v1/documents/:id/bookmarks/:bookmarkId`. */
export class DeleteBookmarkQueryDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: "Instant de la suppression SUR L'APPAREIL : le plus récent gagne",
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  deletedAt!: string;
}

/** Un marque-page, ancrage vérifié sur le texte courant (ADR-0028 §4). */
export class BookmarkResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  pageNumber!: number;

  @ApiProperty({
    minimum: 0,
    description: 'Index du mot dans la page, retrouvé sur le texte courant',
  })
  wordIndex!: number;

  @ApiProperty({ description: 'Quelques mots à partir de l’ancrage' })
  excerpt!: string;

  @ApiProperty()
  note!: string;

  @ApiProperty({
    description:
      'Texte modifié depuis la création et extrait introuvable : placé au mot le plus proche, à vérifier',
  })
  needsReview!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Renseigné si une suppression plus récente l’emporte : retirer le marque-page',
  })
  deletedAt!: string | null;
}

export class BookmarkListResponseDto {
  @ApiProperty({ type: [BookmarkResponseDto] })
  items!: BookmarkResponseDto[];
}
