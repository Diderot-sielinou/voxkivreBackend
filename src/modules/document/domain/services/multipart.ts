/**
 * Envoi par morceaux (ADR-0029) : plan des morceaux d'un fichier et
 * morceaux encore à envoyer. Pur : aucune dépendance au stockage.
 */

/** 5 Mio : le minimum S3 pour un morceau (sauf le dernier). */
export const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export interface PlannedPart {
  /** De 1 à N, comme S3. */
  readonly partNumber: number;
  readonly sizeBytes: number;
}

/** Morceau reçu par le stockage. */
export interface ReceivedPart {
  readonly partNumber: number;
  readonly sizeBytes: number;
}

/** L'envoi par morceaux vaut la peine : demandé, et plus d'un morceau. */
export function usesMultipart(sizeBytes: number, requested: boolean): boolean {
  return requested && sizeBytes > MULTIPART_PART_SIZE_BYTES;
}

/** Morceaux de `MULTIPART_PART_SIZE_BYTES`, le dernier avec le reste. */
export function planParts(sizeBytes: number): readonly PlannedPart[] {
  const count = Math.max(1, Math.ceil(sizeBytes / MULTIPART_PART_SIZE_BYTES));
  return Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    sizeBytes:
      index === count - 1
        ? sizeBytes - index * MULTIPART_PART_SIZE_BYTES
        : MULTIPART_PART_SIZE_BYTES,
  }));
}

/**
 * Morceaux du plan pas encore reçus **à la bonne taille** (un morceau
 * tronqué est renvoyé : S3 garde le dernier envoi d'un même numéro).
 */
export function missingParts(
  plan: readonly PlannedPart[],
  received: readonly ReceivedPart[],
): readonly PlannedPart[] {
  const sizes = new Map(received.map((part) => [part.partNumber, part.sizeBytes]));
  return plan.filter((part) => sizes.get(part.partNumber) !== part.sizeBytes);
}
