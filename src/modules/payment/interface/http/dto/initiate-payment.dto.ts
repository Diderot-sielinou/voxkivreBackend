import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class InitiatePaymentDto {
  @ApiProperty({ description: 'Code de l’offre (GET /v1/billing/offers)', example: 'pass-30d' })
  @IsString()
  // Borne de transport : le catalogue fait foi.
  @MaxLength(32)
  offerCode!: string;

  @ApiProperty({
    description: 'Numéro Mobile Money (MTN ou Orange, Cameroun) : +2376…, 2376… ou 6… (9 chiffres)',
    example: '+237699000000',
  })
  @IsString()
  // Borne de transport (espaces et séparateurs tolérés) : le domaine valide.
  @MaxLength(24)
  phoneNumber!: string;
}
