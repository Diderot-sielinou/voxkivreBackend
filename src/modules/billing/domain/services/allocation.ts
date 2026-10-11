import { Result } from '@/shared/kernel';

import { Units, type VoiceTier } from '../value-objects/units.vo';

/** Sources d'unités d'un utilisateur (ADR-0019). */
export type QuotaSource = 'free' | 'pass' | 'credits';

/**
 * Ordre de débit : le plus périssable d'abord. Le gratuit se perd à la fin
 * du mois, le pass à son échéance, les crédits jamais.
 */
export const DEBIT_ORDER: readonly QuotaSource[] = ['free', 'pass', 'credits'];

/** Ordre de remboursement : l'inverse du débit (ADR-0019 §4). */
const REFUND_ORDER: readonly QuotaSource[] = DEBIT_ORDER.toReversed();

/** Unités par source (disponibles, ou prises par une réservation). */
export type UnitsBySource = Readonly<Record<QuotaSource, Units>>;

/** Le total utilisable ne couvre pas la demande : rien n'est pris. */
export interface Shortfall {
  readonly requested: Units;
  readonly tier: VoiceTier;
  /** Ce que chaque source contient (le gratuit même s'il est inutilisable pour cette voix). */
  readonly available: UnitsBySource;
  /** Ce qui pouvait servir pour cette voix. */
  readonly usable: Units;
}

/** Le palier gratuit ne finance que les voix standard (CdC §2.3). */
function usableFrom(source: QuotaSource, tier: VoiceTier, available: UnitsBySource): number {
  return source === 'free' && tier !== 'standard' ? 0 : available[source];
}

/**
 * Répartit `requested` unités entre les sources, dans l'ordre de débit
 * (ADR-0019 §2). Tout ou rien : une demande non couverte renvoie le manque
 * sans rien prendre.
 */
export function allocate(input: {
  readonly requested: Units;
  readonly tier: VoiceTier;
  readonly available: UnitsBySource;
}): Result<UnitsBySource, Shortfall> {
  const taken = { free: 0, pass: 0, credits: 0 };
  let missing: number = input.requested;
  for (const source of DEBIT_ORDER) {
    const take = Math.min(missing, usableFrom(source, input.tier, input.available));
    taken[source] = take;
    missing -= take;
  }
  if (missing > 0) {
    return Result.err({
      requested: input.requested,
      tier: input.tier,
      available: input.available,
      usable: Units.of(input.requested - missing),
    });
  }
  return Result.ok({
    free: Units.of(taken.free),
    pass: Units.of(taken.pass),
    credits: Units.of(taken.credits),
  });
}

/**
 * Répartit un remboursement de `units` unités entre les sources d'une
 * réservation, **dans l'ordre inverse du débit** (ADR-0019 §4) : la part
 * consommée est imputée aux premières sources, on rend donc d'abord les
 * crédits, puis le pass, puis le gratuit. Jamais plus que ce que chaque
 * source avait donné.
 */
export function splitRefund(reserved: UnitsBySource, units: Units): UnitsBySource {
  const refunded = { free: 0, pass: 0, credits: 0 };
  let left: number = units;
  for (const source of REFUND_ORDER) {
    const give = Math.min(left, reserved[source]);
    refunded[source] = give;
    left -= give;
  }
  return {
    free: Units.of(refunded.free),
    pass: Units.of(refunded.pass),
    credits: Units.of(refunded.credits),
  };
}

/** Somme des unités de toutes les sources. */
export function totalUnits(units: UnitsBySource): Units {
  return Units.of(units.free + units.pass + units.credits);
}
