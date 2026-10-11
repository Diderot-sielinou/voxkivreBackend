import { type Payment } from '@/modules/payment/domain/entities/payment.entity';
import {
  type AttemptCounts,
  type PaymentCompletion,
  type PaymentRepositoryPort,
} from '@/modules/payment/domain/ports/payment-repository.port';
import { type AttemptWindows } from '@/modules/payment/domain/services/payment-policy';
import {
  type PaymentProvider,
  type PaymentStatus,
} from '@/modules/payment/domain/value-objects/payment-status.vo';

/**
 * Paiements en mémoire, mêmes garanties que le dépôt Drizzle : clé
 * d'idempotence unique par utilisateur, transitions conditionnelles.
 */
export class InMemoryPaymentRepository implements PaymentRepositoryPort {
  readonly rows = new Map<string, Payment>();

  insert(payment: Payment): Promise<boolean> {
    const taken = [...this.rows.values()].some(
      (p) => p.userId === payment.userId && p.idempotencyKey === payment.idempotencyKey,
    );
    if (!taken) this.rows.set(payment.id, payment);
    return Promise.resolve(!taken);
  }

  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Payment | null> {
    return this.find((p) => p.userId === userId && p.idempotencyKey === idempotencyKey);
  }

  findByIdForUser(id: string, userId: string): Promise<Payment | null> {
    return this.find((p) => p.id === id && p.userId === userId);
  }

  findByProviderReference(provider: PaymentProvider, reference: string): Promise<Payment | null> {
    return this.find((p) => p.provider === provider && p.providerReference === reference);
  }

  findByExternalReference(externalReference: string): Promise<Payment | null> {
    return this.find((p) => p.externalReference === externalReference);
  }

  countAttempts(
    userId: string,
    phoneHmac: string,
    windows: AttemptWindows,
  ): Promise<AttemptCounts> {
    const all = [...this.rows.values()];
    const inFlight = all
      .filter((p) => p.userId === userId && p.status === 'pending')
      .filter((p) => p.createdAt > windows.inFlightSince)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve({
      inFlightPaymentId: inFlight.at(0)?.id ?? null,
      userAttemptsLastHour: all.filter(
        (p) => p.userId === userId && p.createdAt >= windows.userSince,
      ).length,
      phoneAttemptsLastDay: all.filter(
        (p) => p.phoneHmac === phoneHmac && p.createdAt >= windows.phoneSince,
      ).length,
    });
  }

  attachProviderReference(id: string, reference: string, at: Date): Promise<boolean> {
    const payment = this.rows.get(id);
    if (payment === undefined) return Promise.resolve(false);
    if (payment.providerReference !== null) return Promise.resolve(false);
    this.rows.set(id, { ...payment, providerReference: reference, updatedAt: at });
    return Promise.resolve(true);
  }

  complete(
    id: string,
    from: PaymentStatus,
    completion: PaymentCompletion,
    at: Date,
  ): Promise<boolean> {
    const payment = this.rows.get(id);
    if (payment?.status !== from) return Promise.resolve(false);
    this.rows.set(id, {
      ...payment,
      status: completion.status,
      confirmedVia: 'via' in completion ? completion.via : null,
      failureCode: 'failureCode' in completion ? completion.failureCode : null,
      completedAt: at,
      updatedAt: at,
    });
    return Promise.resolve(true);
  }

  listPendingCreatedBefore(createdBefore: Date, limit: number): Promise<readonly Payment[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((p) => p.status === 'pending' && p.createdAt < createdBefore)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit),
    );
  }

  private find(predicate: (payment: Payment) => boolean): Promise<Payment | null> {
    return Promise.resolve([...this.rows.values()].find((payment) => predicate(payment)) ?? null);
  }
}
