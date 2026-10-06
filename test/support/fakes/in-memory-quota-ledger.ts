import {
  type QuotaLedgerPort,
  type ReserveCharsInput,
  type ReserveOutcome,
} from '@/modules/billing/domain/ports/quota-ledger.port';
import { type QuotaPeriod } from '@/modules/billing/domain/value-objects/quota-period.vo';

interface Reservation {
  readonly userId: string;
  readonly period: string;
  readonly chars: number;
  refunded: number | null;
}

/** Fake du `QuotaLedgerPort` : mêmes règles que l'adapter SQL, en mémoire. */
export class InMemoryQuotaLedger implements QuotaLedgerPort {
  readonly usageByKey = new Map<string, number>();
  readonly reservations = new Map<string, Reservation>();

  reserve(input: ReserveCharsInput): Promise<ReserveOutcome> {
    if (this.reservations.has(input.reservationId)) return Promise.resolve('already_reserved');
    const key = `${input.userId}|${input.period}`;
    const used = this.usageByKey.get(key) ?? 0;
    if (used + input.chars > input.limit) return Promise.resolve('exceeded');
    this.usageByKey.set(key, used + input.chars);
    this.reservations.set(input.reservationId, {
      userId: input.userId,
      period: input.period,
      chars: input.chars,
      refunded: null,
    });
    return Promise.resolve('reserved');
  }

  refund(reservationId: string, chars: number): Promise<boolean> {
    const reservation = this.reservations.get(reservationId);
    if (reservation?.refunded !== null) return Promise.resolve(false);
    const refunded = Math.min(chars, reservation.chars);
    reservation.refunded = refunded;
    const key = `${reservation.userId}|${reservation.period}`;
    this.usageByKey.set(key, Math.max(0, (this.usageByKey.get(key) ?? 0) - refunded));
    return Promise.resolve(true);
  }

  usage(userId: string, period: QuotaPeriod): Promise<number> {
    return Promise.resolve(this.usageByKey.get(`${userId}|${period}`) ?? 0);
  }
}
