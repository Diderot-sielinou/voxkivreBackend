import { Units } from './value-objects/units.vo';

/**
 * Période d'un pass acheté (ADR-0019 §3) : des unités utilisables entre
 * `startsAt` (inclus) et `endsAt` (exclu), perdues ensuite. Une ligne par
 * achat ; un pass acheté d'avance commence à la fin du précédent.
 */
export interface Pass {
  readonly id: string;
  readonly userId: string;
  readonly offerCode: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly includedUnits: Units;
  readonly usedUnits: Units;
}

export function isPassActiveAt(pass: Pick<Pass, 'startsAt' | 'endsAt'>, at: Date): boolean {
  return pass.startsAt.getTime() <= at.getTime() && at.getTime() < pass.endsAt.getTime();
}

export function remainingPassUnits(pass: Pick<Pass, 'includedUnits' | 'usedUnits'>): Units {
  return Units.of(Math.max(0, pass.includedUnits - pass.usedUnits));
}
