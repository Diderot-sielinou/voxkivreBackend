import { type QuotaPeriod } from '../value-objects/quota-period.vo';

export const QUOTA_LEDGER = Symbol('QuotaLedger');

export interface ReserveCharsInput {
  /** Identifiant de l'opération débitée (la conversion) : une seule réservation par opération. */
  readonly reservationId: string;
  readonly userId: string;
  readonly period: QuotaPeriod;
  readonly chars: number;
  /** Limite de la période : la réservation échoue si elle la ferait dépasser. */
  readonly limit: number;
  readonly at: Date;
}

/**
 * - `reserved`         : caractères ajoutés au compteur de la période ;
 * - `already_reserved` : cette opération était déjà réservée (rien de plus) ;
 * - `exceeded`         : la limite serait dépassée (rien n'est écrit).
 */
export type ReserveOutcome = 'reserved' | 'already_reserved' | 'exceeded';

/**
 * Compteurs de quota (ADR-0010). `tx` : transaction ambiante transmise par
 * le use-case (`UnitOfWork`) ; sans `tx`, l'adapter utilise sa connexion.
 */
export interface QuotaLedgerPort {
  /** **Atomique** et sans course entre deux réservations simultanées. */
  reserve(input: ReserveCharsInput, tx?: unknown): Promise<ReserveOutcome>;

  /**
   * Rend `chars` (au plus le montant réservé) **une seule fois** par
   * réservation. `false` si elle est inconnue ou déjà remboursée.
   */
  refund(reservationId: string, chars: number, at: Date, tx?: unknown): Promise<boolean>;

  /** Caractères réservés sur la période (0 si aucun). */
  usage(userId: string, period: QuotaPeriod): Promise<number>;
}
