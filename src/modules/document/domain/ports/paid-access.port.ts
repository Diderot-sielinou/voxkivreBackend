export const PAID_ACCESS = Symbol('PaidAccess');

/**
 * Le compte a-t-il un pass en cours ou des crédits ? Lu dans `billing` par
 * un adapter (ADR-0024 : le plafond mensuel d'OCR ne vaut que pour les
 * comptes gratuits).
 */
export interface PaidAccessPort {
  hasPaidAccess(userId: string): Promise<boolean>;
}
