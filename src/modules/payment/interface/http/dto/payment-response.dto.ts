import { ApiProperty } from '@nestjs/swagger';

import {
  PaymentFailureCode,
  PaymentStatus,
} from '@/modules/payment/domain/value-objects/payment-status.vo';

/**
 * Représentation HTTP d'un paiement. Les références du prestataire, les
 * empreintes et la clé d'idempotence ne sont jamais exposées.
 */
export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: Object.values(PaymentStatus),
    description:
      'pending : en attente de confirmation sur le téléphone ; succeeded : offre accordée',
  })
  status!: PaymentStatus;

  @ApiProperty({ example: 'pass-30d' })
  offerCode!: string;

  @ApiProperty({ description: 'Montant demandé, en francs CFA (XAF)', example: 2000 })
  amountXaf!: number;

  @ApiProperty({ description: 'Deux derniers chiffres du numéro débité', example: '47' })
  phoneSuffix!: string;

  @ApiProperty({
    enum: Object.values(PaymentFailureCode),
    nullable: true,
    description: 'Raison stable quand status = failed ou expired',
  })
  failureCode!: PaymentFailureCode | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
}
