import { type PurchaseGrant } from '../services/purchase-grant';

export const PURCHASE_LEDGER = Symbol('PurchaseLedger');

/** Un achat déjà accordé, retrouvé par sa référence de paiement. */
export interface GrantedPurchase {
  readonly paymentReference: string;
  readonly userId: string;
  readonly grant: PurchaseGrant;
}

/**
 * Achats accordés (ADR-0019 §9). La référence de paiement est **unique** en
 * base : un même paiement n'accorde jamais deux fois (RNF-09).
 */
export interface PurchaseLedgerPort {
  findPurchase(paymentReference: string, tx: unknown): Promise<GrantedPurchase | null>;

  /**
   * Verrouille l'utilisateur (son portefeuille, créé au besoin) le temps de
   * l'achat, et renvoie la fin de son dernier pass (`null` si aucun) : deux
   * pass achetés en même temps ne se chevauchent pas.
   */
  lockForPurchase(userId: string, at: Date, tx: unknown): Promise<Date | null>;

  /**
   * Pass : une période ; crédits : solde augmenté + écriture au journal.
   * `false` (et rien d'écrit) si la référence a été accordée entre-temps par
   * une requête concurrente (webhook rejoué en parallèle).
   */
  recordPurchase(purchase: GrantedPurchase, at: Date, tx: unknown): Promise<boolean>;
}
