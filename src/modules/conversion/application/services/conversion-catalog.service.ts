import { Inject, Injectable } from '@nestjs/common';

import { type Conversion } from '../../domain/entities/conversion.entity';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import {
  conversionFileKeys,
  isConversionRunning,
  playableExtent,
  selectLibraryConversion,
} from '../../domain/services/conversion-overview';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import {
  type ConversionFailureReason,
  type ConversionStatus,
} from '../../domain/value-objects/conversion-status.vo';

/** Ce qu'un autre module peut savoir d'une conversion (jamais l'entité). */
export interface ConversionOverview {
  readonly conversionId: string;
  readonly documentId: string;
  readonly voiceId: string;
  readonly status: ConversionStatus;
  readonly failureReason: ConversionFailureReason | null;
  /** `null` tant que la préparation n'a pas fixé le plan. */
  readonly partCount: number | null;
  readonly partsReady: number;
  /** Mots et durée écoutables depuis le début (préfixe continu de parties). */
  readonly playableWordCount: number;
  readonly playableDurationMs: number;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

/** Ce qu'il faut savoir des conversions d'un document avant de le supprimer (ADR-0016). */
export interface DocumentConversionsCleanup {
  /** Une conversion travaille encore : la suppression est refusée. */
  readonly running: boolean;
  /** Fichiers à effacer du stockage objet. */
  readonly fileKeys: readonly string[];
}

/**
 * Lecture des conversions **pour les autres modules** (la bibliothèque,
 * ADR-0015) : exporté par `ConversionModule`, consommé derrière un port du
 * module appelant. Lectures groupées (une page de bibliothèque = deux
 * requêtes), identifiants en `string`.
 */
@Injectable()
export class ConversionCatalog {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
  ) {}

  /** Conversion retenue par document (ADR-0015 §5) ; absente si le document n'en a aucune. */
  async overviewsByDocument(
    ownerId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ConversionOverview>> {
    const all = await this.conversions.listForDocuments(ownerId, documentIds);
    const byDocument = groupBy(all, (c) => c.documentId);
    const selected = [...byDocument.values()]
      .map((candidates) => selectLibraryConversion(candidates))
      .filter((c): c is Conversion => c !== null);
    const parts = groupBy(
      await this.conversions.listPartsOf(selected.map((c) => c.id)),
      (p) => p.conversionId,
    );
    return new Map(
      selected.map((c) => [c.documentId, toOverview(c, parts.get(c.id) ?? [])] as const),
    );
  }

  /** Filtré par propriétaire (RNF-08) : `null` si absente ou à quelqu'un d'autre. */
  async overviewForOwner(
    conversionId: string,
    ownerId: string,
  ): Promise<ConversionOverview | null> {
    const conversion = await this.conversions.findByIdForOwner(
      ConversionId.of(conversionId),
      ownerId,
    );
    if (conversion === null) return null;
    return toOverview(conversion, await this.conversions.listParts(conversion.id));
  }

  /** Lu dans la transaction de la suppression (ADR-0016). */
  async cleanupForDocument(documentId: string, tx?: unknown): Promise<DocumentConversionsCleanup> {
    const conversions = await this.conversions.listForDocument(documentId, tx);
    return {
      running: conversions.some((c) => isConversionRunning(c)),
      fileKeys: conversions.flatMap((c) => conversionFileKeys(c)),
    };
  }
}

/** `Map.groupBy` (ES2024) n'est pas dans la cible ES2023 du projet. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

function toOverview(
  conversion: Conversion,
  parts: Parameters<typeof playableExtent>[0],
): ConversionOverview {
  const playable = playableExtent(parts);
  return {
    conversionId: conversion.id,
    documentId: conversion.documentId,
    voiceId: conversion.voiceId,
    status: conversion.status,
    failureReason: conversion.failureReason,
    partCount: conversion.partCount,
    partsReady: playable.partsReady,
    playableWordCount: playable.wordCount,
    playableDurationMs: playable.durationMs,
    createdAt: conversion.createdAt,
    completedAt: conversion.completedAt,
  };
}
