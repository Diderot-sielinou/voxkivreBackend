/**
 * Limites du quota en caractères (RF-24, RNF-25, ADR-0010). Valeurs de
 * départ fournies par la config ; les abonnements et crédits (étape
 * `billing`) relèveront la limite mensuelle derrière ce même objet.
 */
export interface QuotaPolicy {
  /** Caractères offerts par mois civil. */
  readonly freeTierCharsPerMonth: number;
  /** Plafond d'une seule conversion. */
  readonly maxCharsPerConversion: number;
}

export const QUOTA_POLICY = Symbol('QuotaPolicy');
