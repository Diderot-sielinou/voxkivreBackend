import { Inject, Injectable } from '@nestjs/common';

import { Result } from '@/shared/kernel';

import { type Payment } from '../../domain/entities/payment.entity';
import { PaymentNotFoundError } from '../../domain/errors/payment-not-found.error';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';

/**
 * `GET /v1/payments/:id` : l'app interroge l'état pendant que le client
 * confirme sur son téléphone (ADR-0021 §2). Lecture en base seulement :
 * aucun appel au prestataire, quel que soit le rythme des requêtes.
 */
@Injectable()
export class GetPaymentUseCase {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort) {}

  async execute(id: string, userId: string): Promise<Result<Payment, PaymentNotFoundError>> {
    const payment = await this.payments.findByIdForUser(id, userId);
    return payment === null ? Result.err(new PaymentNotFoundError()) : Result.ok(payment);
  }
}
