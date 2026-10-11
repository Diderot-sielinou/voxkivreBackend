import { type Payment } from '@/modules/payment/domain/entities/payment.entity';

import { type PaymentResponseDto } from '../dto/payment-response.dto';

export function toPaymentResponseDto(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    status: payment.status,
    offerCode: payment.offerCode,
    amountXaf: payment.amountXaf,
    phoneSuffix: payment.phoneSuffix,
    failureCode: payment.failureCode,
    createdAt: payment.createdAt.toISOString(),
    completedAt: payment.completedAt?.toISOString() ?? null,
  };
}
