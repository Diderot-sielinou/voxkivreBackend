import { type ConversionId } from '../value-objects/conversion-id.vo';

/** Un mot lu, avec la page d'où il vient (scroll-to-seek, RF-10). */
export interface SegmentWord {
  /** Texte du mot tel qu'affiché (ponctuation comprise). */
  readonly t: string;
  /** Numéro de page (1-based). */
  readonly p: number;
}

/** Segment prêt à être synthétisé : sortie de la préparation. */
export interface PreparedSegment {
  readonly index: number;
  /** SSML complet, ≤ 5 000 octets marques comprises ; marque `w<i>` avant le i-ème mot. */
  readonly ssml: string;
  readonly words: readonly SegmentWord[];
  readonly charCount: number;
  /** SHA-256(signature du moteur + SSML) : clé du cache (RNF-26). */
  readonly fingerprint: string;
}

/** Résultat de la synthèse d'un segment. */
export interface SegmentAudio {
  readonly audioKey: string;
  /** Début de chaque mot en secondes, aligné sur `words` (`null` si le moteur n'a pas renvoyé la marque). */
  readonly timepoints: readonly (number | null)[];
  readonly durationMs: number;
  readonly cacheHit: boolean;
}

export interface ConversionSegment extends PreparedSegment {
  readonly conversionId: ConversionId;
  /** `null` tant que le segment n'est pas synthétisé. */
  readonly audio: SegmentAudio | null;
}
