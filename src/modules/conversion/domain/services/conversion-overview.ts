import { type ConversionPart } from '../entities/conversion-part.entity';
import { type Conversion } from '../entities/conversion.entity';
import { ConversionStatus } from '../value-objects/conversion-status.vo';

import { manifestKey, partFileKeys } from './conversion-files';

/**
 * Conversion qui représente un livre dans la bibliothèque (ADR-0015) : la
 * plus récente **non échouée**, sinon la plus récente échouée — un nouvel
 * essai raté ne masque pas un livre déjà écoutable.
 */
export function selectLibraryConversion(candidates: readonly Conversion[]): Conversion | null {
  const newestFirst = candidates.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return newestFirst.find((c) => c.status !== ConversionStatus.FAILED) ?? newestFirst.at(0) ?? null;
}

/** Ce qui s'écoute déjà d'une conversion. */
export interface PlayableExtent {
  /** Parties assemblées (dans n'importe quel ordre). */
  readonly partsReady: number;
  /**
   * Mots et durée du **préfixe continu** de parties assemblées depuis la
   * première : le lecteur lit les parties dans l'ordre, une partie 3 prête
   * avant la 2 ne s'écoute pas encore.
   */
  readonly wordCount: number;
  readonly durationMs: number;
}

export function playableExtent(parts: readonly ConversionPart[]): PlayableExtent {
  const ordered = parts.toSorted((a, b) => a.index - b.index);
  let wordCount = 0;
  let durationMs = 0;
  for (const [position, part] of ordered.entries()) {
    if (part.index !== position || part.assembled === null) break;
    wordCount = part.firstWordIndex + part.assembled.wordCount;
    durationMs += part.assembled.durationMs;
  }
  return {
    partsReady: ordered.filter((p) => p.assembled !== null).length,
    wordCount,
    durationMs,
  };
}

/**
 * Clés de TOUS les fichiers qu'une conversion a pu écrire (ADR-0011) :
 * manifeste et parties planifiées. Effacer une clé absente réussit, donc la
 * liste peut être large (ADR-0016).
 */
export function conversionFileKeys(conversion: Conversion): readonly string[] {
  const parts = Array.from({ length: conversion.partCount ?? 0 }, (_, index) =>
    partFileKeys(conversion.ownerId, conversion.id, index),
  ).flatMap((keys) => [keys.audio, keys.vtt]);
  return [manifestKey(conversion.ownerId, conversion.id), ...parts];
}

/** Statuts où la conversion travaille encore : on ne supprime pas son document (ADR-0016). */
export function isConversionRunning(conversion: Conversion): boolean {
  return (
    conversion.status !== ConversionStatus.READY && conversion.status !== ConversionStatus.FAILED
  );
}
