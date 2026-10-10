import { type Brand } from '@/shared/kernel';

/**
 * Montant en **francs CFA (XAF)**, entier (ADR-0019) : le franc CFA n'a pas
 * de subdivision en usage, et un entier évite toute erreur d'arrondi.
 */
export type Money = Brand<number, 'MoneyXaf'>;

export const Money = {
  /**
   * Invariant (pas une erreur métier) : les montants viennent du catalogue
   * en base, contraint par `CHECK`. Une valeur invalide est un bug.
   */
  xaf(amount: number): Money {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RangeError(`Money: ${String(amount)} is not a non-negative whole XAF amount`);
    }
    return amount as Money;
  },
} as const;
