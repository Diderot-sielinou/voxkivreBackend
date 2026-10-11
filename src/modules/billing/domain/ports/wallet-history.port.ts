import { type CreditEntryKind } from '../credit-entry';

export const WALLET_HISTORY = Symbol('WalletHistory');

/** Un mouvement du portefeuille, tel qu'affiché à l'utilisateur. */
export interface WalletEntry {
  readonly id: string;
  readonly kind: CreditEntryKind;
  /** Signé : positif pour un achat ou un remboursement, négatif pour une consommation. */
  readonly units: number;
  readonly createdAt: Date;
  /** Offre achetée (achat) ou conversion concernée (consommation, remboursement). */
  readonly offerCode: string | null;
  readonly reservationId: string | null;
}

export interface WalletEntryPosition {
  readonly createdAt: Date;
  readonly id: string;
}

/** Historique du portefeuille (ADR-0019 §10), du plus récent au plus ancien. */
export interface WalletHistoryPort {
  listEntries(
    userId: string,
    after: WalletEntryPosition | null,
    limit: number,
  ): Promise<readonly WalletEntry[]>;
}
