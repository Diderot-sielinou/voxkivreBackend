import { ApiProperty } from '@nestjs/swagger';

export class OfferDto {
  @ApiProperty({ example: 'pass-30d' })
  code!: string;

  @ApiProperty({ enum: ['pass', 'credits'] })
  kind!: 'pass' | 'credits';

  @ApiProperty({ example: 2000, description: 'Prix en francs CFA (XAF), entier' })
  priceXaf!: number;

  @ApiProperty({
    example: 250_000,
    description: 'Unités données (1 unité = 1 caractère en voix standard)',
  })
  units!: number;

  @ApiProperty({
    example: 30,
    nullable: true,
    type: Number,
    description: 'Durée d’un pass ; `null` pour des crédits',
  })
  durationDays!: number | null;
}

export class VoiceTierWeightsDto {
  @ApiProperty({ example: 1 })
  standard!: number;

  @ApiProperty({ example: 4 })
  natural!: number;
}

export class OfferListResponseDto {
  @ApiProperty({ type: [OfferDto] })
  items!: OfferDto[];

  @ApiProperty({
    type: VoiceTierWeightsDto,
    description: 'Unités consommées par caractère selon la gamme de la voix (ADR-0019)',
  })
  voiceTierWeights!: VoiceTierWeightsDto;
}

export class FreeTierDto {
  @ApiProperty({ example: 50_000 })
  limit!: number;

  @ApiProperty({ example: 12_000 })
  used!: number;

  @ApiProperty({ example: 38_000 })
  remaining!: number;
}

export class PassStatusDto {
  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({ example: 250_000 })
  includedUnits!: number;

  @ApiProperty({ example: 40_000 })
  usedUnits!: number;

  @ApiProperty({ example: 210_000 })
  remainingUnits!: number;
}

export class BillingAccountResponseDto {
  @ApiProperty({ example: '2026-10', description: 'Mois civil UTC du palier gratuit' })
  period!: string;

  @ApiProperty({ type: FreeTierDto, description: 'Palier gratuit : voix standard seulement' })
  free!: FreeTierDto;

  @ApiProperty({ type: PassStatusDto, nullable: true, description: 'Pass en cours, sinon `null`' })
  pass!: PassStatusDto | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Début du prochain pass déjà payé (renouvellement anticipé)',
  })
  nextPassStartsAt!: string | null;

  @ApiProperty({ example: 50_000, description: 'Solde de crédits, en unités (sans expiration)' })
  credits!: number;

  @ApiProperty({
    example: 1_000_000,
    description: 'Plafond d’une conversion, en caractères (RNF-25)',
  })
  maxCharsPerConversion!: number;
}

export class WalletEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['purchase', 'consumption', 'refund'] })
  kind!: 'purchase' | 'consumption' | 'refund';

  @ApiProperty({ example: -4000, description: 'Signé : + achat ou remboursement, − consommation' })
  units!: number;

  @ApiProperty({ example: '2026-10-10T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Offre achetée (achat)' })
  offerCode!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Conversion concernée (consommation, remboursement)',
  })
  conversionId!: string | null;
}

export class WalletEntryListResponseDto {
  @ApiProperty({ type: [WalletEntryDto] })
  items!: WalletEntryDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
