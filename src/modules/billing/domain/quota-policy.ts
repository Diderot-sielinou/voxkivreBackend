/**
 * Limites du quota (RF-24, RNF-25, ADR-0010, ADR-0019), depuis la config.
 */
export interface QuotaPolicy {
  /** Unités offertes par mois civil UTC, voix standard seulement (ADR-0019). */
  readonly freeTierUnitsPerMonth: number;
  /** Plafond d'une seule conversion, en **caractères** (taille du document). */
  readonly maxCharsPerConversion: number;
}

export const QUOTA_POLICY = Symbol('QuotaPolicy');
