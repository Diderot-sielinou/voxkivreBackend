import { type Brand } from '@/shared/kernel';

/**
 * Unité de compte du quota (ADR-0019) : un caractère en voix standard. Une
 * voix naturelle coûte 4 fois plus cher à Polly (ADR-0013) : chaque
 * caractère y compte pour 4 unités. Toujours un entier positif ou nul.
 */
export type Units = Brand<number, 'Units'>;

/** Gamme d'une voix : fixe son poids et l'accès au palier gratuit. */
export type VoiceTier = 'standard' | 'natural';

/** Unités par caractère, selon la gamme de la voix. */
export const VOICE_TIER_WEIGHTS: Readonly<Record<VoiceTier, number>> = {
  standard: 1,
  natural: 4,
};

export const Units = {
  /** Invariant : un compteur d'unités n'est jamais fractionnaire ni négatif. */
  of(value: number): Units {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Units: ${String(value)} is not a non-negative integer`);
    }
    return value as Units;
  },

  /** Coût en unités de `chars` caractères synthétisés avec une voix de gamme `tier`. */
  forChars(chars: number, tier: VoiceTier): Units {
    return Units.of(chars * VOICE_TIER_WEIGHTS[tier]);
  },
} as const;
