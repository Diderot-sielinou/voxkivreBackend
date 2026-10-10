import { type DomainError, type Result } from '@/shared/kernel';

import { type VoiceTier } from '../voices';

export const QUOTA = Symbol('ConversionQuota');

/**
 * Quota (ADR-0010, ADR-0019), implémenté par un adapter vers
 * `BillingModule`. `reserve` rejoint la transaction en cours de l'appelant.
 * Le coût dépend de la gamme de la voix, transmise à la réservation.
 */
export interface QuotaPort {
  /** Réserve `chars` pour l'opération `reservationId` (idempotent). Erreur métier si refusé. */
  reserve(input: {
    readonly reservationId: string;
    readonly userId: string;
    readonly chars: number;
    readonly voiceTier: VoiceTier;
  }): Promise<Result<void, DomainError>>;

  /** Rend jusqu'à `chars` de la réservation, une seule fois. */
  refund(reservationId: string, chars: number): Promise<void>;
}
