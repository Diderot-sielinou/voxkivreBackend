export const ACCOUNT_ACTIVITY = Symbol('AccountActivity');

/** Ce qui empêche de supprimer un compte (ADR-0023 §1). */
export type AccountDeletionBlocker = 'conversion_in_progress' | 'payment_pending';

/** Travail en cours d'un compte, implémenté par un adapter vers `conversion` et `payment`. */
export interface AccountActivityPort {
  /** Lu dans la transaction `tx` (sans : simple lecture) ; `null` si rien n'empêche la suppression. */
  findBlocker(userId: string, tx?: unknown): Promise<AccountDeletionBlocker | null>;
}
