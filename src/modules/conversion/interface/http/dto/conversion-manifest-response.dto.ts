import { ApiProperty } from '@nestjs/swagger';

export class ManifestFileDto {
  @ApiProperty({ example: 'part-001.mp3' })
  name!: string;

  @ApiProperty({ description: 'Taille en octets' })
  bytes!: number;

  @ApiProperty({
    description: 'SHA-256 hexadécimal : contrôle d’intégrité du fichier local (RF-17)',
  })
  sha256!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'URL de téléchargement signée (voir urlsExpireAt) ; accepte les requêtes par plage',
  })
  url!: string | null;
}

export class PageStartDto {
  @ApiProperty()
  page!: number;

  @ApiProperty({ description: 'Index global du premier mot de la page' })
  wordIndex!: number;
}

export class ManifestPartDto {
  @ApiProperty({ description: '0 = aperçu' })
  index!: number;

  @ApiProperty({ enum: ['ready', 'pending'] })
  status!: 'ready' | 'pending';

  @ApiProperty({ description: 'Index global du premier mot (identifiant des repères WebVTT)' })
  firstWordIndex!: number;

  @ApiProperty({ type: Number, nullable: true })
  durationMs!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Début dans le livre, connu quand les parties précédentes sont prêtes',
  })
  startMs!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  wordCount!: number | null;

  @ApiProperty({ type: [PageStartDto], description: 'Pages qui commencent dans cette partie' })
  pageStarts!: PageStartDto[];

  @ApiProperty({ type: ManifestFileDto, nullable: true, description: 'MP3 de la partie' })
  audio!: ManifestFileDto | null;

  @ApiProperty({ type: ManifestFileDto, nullable: true, description: 'WebVTT : un repère par mot' })
  vtt!: ManifestFileDto | null;
}

/** Manifeste d'une conversion (ADR-0011, `version` 1) : de quoi lire le livre hors ligne. */
export class ConversionManifestResponseDto {
  @ApiProperty({ example: 1, description: 'Format du manifeste ; refuser une version inconnue' })
  version!: number;

  @ApiProperty({ format: 'uuid' })
  conversionId!: string;

  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'fr-f1' })
  voiceId!: string;

  @ApiProperty()
  textRevision!: number;

  @ApiProperty({ description: 'Toutes les parties sont prêtes' })
  complete!: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'Durée totale, connue quand complete' })
  durationMs!: number | null;

  @ApiProperty()
  partCount!: number;

  @ApiProperty({ type: String, format: 'date-time', description: 'Expiration des URL signées' })
  urlsExpireAt!: string;

  @ApiProperty({ type: [ManifestPartDto] })
  parts!: ManifestPartDto[];
}
