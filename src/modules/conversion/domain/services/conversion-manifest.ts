import { type ConversionPart, type PageStart } from '../entities/conversion-part.entity';
import { type Conversion } from '../entities/conversion.entity';

/** Version du format : un changement incompatible = 2, refusé par un mobile qui ne la connaît pas. */
export const MANIFEST_VERSION = 1;

export interface ManifestFile {
  /** Nom du fichier dans le dossier de la conversion (`part-001.mp3`). */
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ManifestPart {
  readonly index: number;
  readonly status: 'ready' | 'pending';
  readonly firstWordIndex: number;
  /** Renseignés une fois la partie assemblée. */
  readonly durationMs: number | null;
  /** Début dans le livre entier ; connu quand toutes les parties précédentes le sont. */
  readonly startMs: number | null;
  readonly wordCount: number | null;
  readonly pageStarts: readonly PageStart[];
  readonly audio: ManifestFile | null;
  readonly vtt: ManifestFile | null;
}

/** Description d'un livre converti (ADR-0011) : tout ce qu'il faut pour le lire hors ligne. */
export interface ConversionManifest {
  readonly version: typeof MANIFEST_VERSION;
  readonly conversionId: string;
  readonly documentId: string;
  readonly voiceId: string;
  readonly textRevision: number;
  /** Toutes les parties sont assemblées. */
  readonly complete: boolean;
  readonly durationMs: number | null;
  readonly partCount: number;
  readonly parts: readonly ManifestPart[];
}

function fileName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

/** Construit le manifeste depuis les parties (dans l'ordre), assemblées ou non. */
export function buildManifest(
  conversion: Conversion,
  parts: readonly ConversionPart[],
): ConversionManifest {
  let elapsed: number | null = 0;
  const manifestParts = parts.map((part): ManifestPart => {
    const assembled = part.assembled;
    const startMs = elapsed;
    elapsed = assembled === null || elapsed === null ? null : elapsed + assembled.durationMs;
    if (assembled === null) {
      return {
        index: part.index,
        status: 'pending',
        firstWordIndex: part.firstWordIndex,
        durationMs: null,
        startMs: null,
        wordCount: null,
        pageStarts: [],
        audio: null,
        vtt: null,
      };
    }
    return {
      index: part.index,
      status: 'ready',
      firstWordIndex: part.firstWordIndex,
      durationMs: assembled.durationMs,
      startMs,
      wordCount: assembled.wordCount,
      pageStarts: assembled.pageStarts,
      audio: {
        name: fileName(assembled.audio.key),
        bytes: assembled.audio.bytes,
        sha256: assembled.audio.sha256,
      },
      vtt: {
        name: fileName(assembled.vtt.key),
        bytes: assembled.vtt.bytes,
        sha256: assembled.vtt.sha256,
      },
    };
  });
  const complete = parts.length > 0 && parts.every((part) => part.assembled !== null);
  return {
    version: MANIFEST_VERSION,
    conversionId: conversion.id,
    documentId: conversion.documentId,
    voiceId: conversion.voiceId,
    textRevision: conversion.textRevision,
    complete,
    durationMs: complete ? elapsed : null,
    partCount: parts.length,
    parts: manifestParts,
  };
}
