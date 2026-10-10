import { type UnitsBySource } from '../services/allocation';
import { type QuotaPeriod } from '../value-objects/quota-period.vo';
import { type Units, type VoiceTier } from '../value-objects/units.vo';

export const UNITS_LEDGER = Symbol('UnitsLedger');

/** Soldes d'un utilisateur, **verrouillés** jusqu'à la fin de la transaction. */
export interface LockedBalances {
  /** Unités du palier gratuit déjà prises sur la période. */
  readonly freeUsed: Units;
  /** Le pass en cours (`null` si aucun) et ce qu'il lui reste. */
  readonly activePass: { readonly id: string; readonly remaining: Units } | null;
  readonly credits: Units;
}

/** Une réservation, avec la part prise à chaque source. */
export interface UnitsReservation {
  readonly reservationId: string;
  readonly userId: string;
  readonly period: QuotaPeriod;
  readonly tier: VoiceTier;
  /** Caractères réservés (ADR-0010 : le remboursement s'exprime en caractères). */
  readonly chars: number;
  /** Le pass débité, s'il y en a un. */
  readonly passId: string | null;
  readonly taken: UnitsBySource;
  readonly refunded: boolean;
}

/** Ce qu'affiche le compte (lecture seule, sans verrou). */
export interface AccountBalances {
  readonly freeUsed: Units;
  readonly currentPass: {
    readonly endsAt: Date;
    readonly includedUnits: Units;
    readonly usedUnits: Units;
  } | null;
  /** Début du prochain pass déjà payé (renouvellement anticipé), sinon `null`. */
  readonly nextPassStartsAt: Date | null;
  readonly credits: Units;
}

/**
 * Compteurs d'unités (ADR-0019). `tx` : transaction ambiante du
 * `UnitOfWork`, **obligatoire** pour tout ce qui verrouille ou écrit.
 *
 * Ordre des verrous, toujours le même (aucun interblocage) : compteur
 * gratuit → pass → portefeuille.
 */
export interface UnitsLedgerPort {
  /** `lock` : verrouille la ligne (remboursement concurrent). */
  findReservation(
    reservationId: string,
    tx: unknown,
    options?: { readonly lock: boolean },
  ): Promise<UnitsReservation | null>;

  /** Verrouille et lit les trois sources (crée les lignes vides au besoin). */
  lockBalances(userId: string, period: QuotaPeriod, at: Date, tx: unknown): Promise<LockedBalances>;

  /** Écrit la réservation et débite chaque source de sa part. */
  recordReservation(
    reservation: Omit<UnitsReservation, 'refunded'>,
    at: Date,
    tx: unknown,
  ): Promise<void>;

  /**
   * Rend à chaque source sa part de `refund`, **une seule fois** : `false`
   * si la réservation est déjà remboursée.
   */
  recordRefund(
    reservation: UnitsReservation,
    refund: UnitsBySource,
    refundedChars: number,
    at: Date,
    tx: unknown,
  ): Promise<boolean>;

  balances(userId: string, period: QuotaPeriod, at: Date): Promise<AccountBalances>;
}
