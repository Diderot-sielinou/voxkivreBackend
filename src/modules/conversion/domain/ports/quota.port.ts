import { type DomainError, type Result } from '@/shared/kernel';

export const QUOTA = Symbol('ConversionQuota');

/**
 * Quota en caractères (ADR-0010), implémenté par un adapter vers
 * `BillingModule`. `reserve` rejoint la transaction en cours de l'appelant.
 */
export interface QuotaPort {
  /** Réserve `chars` pour l'opération `reservationId` (idempotent). Erreur métier si refusé. */
  reserve(input: {
    readonly reservationId: string;
    readonly userId: string;
    readonly chars: number;
  }): Promise<Result<void, DomainError>>;

  /** Rend jusqu'à `chars` de la réservation, une seule fois. */
  refund(reservationId: string, chars: number): Promise<void>;
}
