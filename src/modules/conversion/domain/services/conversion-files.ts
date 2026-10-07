/**
 * Fichiers livrés d'une conversion (ADR-0011), sous le préfixe de leur
 * propriétaire : la purge d'un compte supprime tout d'un préfixe. Clés
 * déterministes : un assemblage relancé réécrit au lieu de dupliquer.
 */
export function conversionFilesPrefix(ownerId: string, conversionId: string): string {
  return `conversions/${encodeURIComponent(ownerId)}/${conversionId}`;
}

/** `part-001`, `part-002`… : tri lexicographique = ordre de lecture. */
export function partFileBase(partIndex: number): string {
  return `part-${String(partIndex + 1).padStart(3, '0')}`;
}

export function partFileKeys(
  ownerId: string,
  conversionId: string,
  partIndex: number,
): { readonly audio: string; readonly vtt: string } {
  const base = `${conversionFilesPrefix(ownerId, conversionId)}/${partFileBase(partIndex)}`;
  return { audio: `${base}.mp3`, vtt: `${base}.vtt` };
}

export function manifestKey(ownerId: string, conversionId: string): string {
  return `${conversionFilesPrefix(ownerId, conversionId)}/manifest.json`;
}
