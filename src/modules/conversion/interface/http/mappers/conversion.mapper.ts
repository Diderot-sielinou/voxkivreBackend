import { type DownloadableManifest } from '@/modules/conversion/application/use-cases/get-conversion-manifest.use-case';
import { type ConversionProgress } from '@/modules/conversion/application/use-cases/get-conversion.use-case';
import { type VoiceOption } from '@/modules/conversion/application/use-cases/list-voices.use-case';
import { type Conversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { type ManifestFile } from '@/modules/conversion/domain/services/conversion-manifest';

import {
  type ConversionManifestResponseDto,
  type ManifestFileDto,
} from '../dto/conversion-manifest-response.dto';
import { type ConversionResponseDto } from '../dto/conversion-response.dto';
import { type VoiceListResponseDto } from '../dto/voice-list-response.dto';

export function toConversionResponseDto(
  conversion: Conversion,
  segmentsDone = 0,
  partsReady = 0,
): ConversionResponseDto {
  return {
    id: conversion.id,
    documentId: conversion.documentId,
    voiceId: conversion.voiceId,
    status: conversion.status,
    reservedChars: conversion.reservedChars,
    progress: {
      segmentsDone,
      segmentCount: conversion.segmentCount,
      partsReady,
      partCount: conversion.partCount,
    },
    failureReason: conversion.failureReason,
    createdAt: conversion.createdAt.toISOString(),
    updatedAt: conversion.updatedAt.toISOString(),
    completedAt: conversion.completedAt?.toISOString() ?? null,
  };
}

export function toConversionProgressDto(progress: ConversionProgress): ConversionResponseDto {
  return toConversionResponseDto(progress.conversion, progress.segmentsDone, progress.partsReady);
}

export function toVoiceListResponseDto(voices: readonly VoiceOption[]): VoiceListResponseDto {
  return {
    items: voices.map((voice) => ({
      id: voice.id,
      label: voice.label,
      gender: voice.gender,
      languageCode: voice.languageCode,
      isDefault: voice.isDefault,
    })),
  };
}

function toManifestFileDto(
  file: ManifestFile | null,
  urls: ReadonlyMap<string, string>,
): ManifestFileDto | null {
  if (file === null) return null;
  return {
    name: file.name,
    bytes: file.bytes,
    sha256: file.sha256,
    url: urls.get(file.name) ?? null,
  };
}

/** Manifeste + URL signées : les clés de stockage ne sont jamais exposées, seulement les noms. */
export function toConversionManifestResponseDto(
  downloadable: DownloadableManifest,
): ConversionManifestResponseDto {
  const { manifest, urls } = downloadable;
  return {
    version: manifest.version,
    conversionId: manifest.conversionId,
    documentId: manifest.documentId,
    voiceId: manifest.voiceId,
    textRevision: manifest.textRevision,
    complete: manifest.complete,
    durationMs: manifest.durationMs,
    partCount: manifest.partCount,
    urlsExpireAt: downloadable.urlsExpireAt.toISOString(),
    parts: manifest.parts.map((part) => ({
      index: part.index,
      status: part.status,
      firstWordIndex: part.firstWordIndex,
      durationMs: part.durationMs,
      startMs: part.startMs,
      wordCount: part.wordCount,
      pageStarts: part.pageStarts.map((start) => ({
        page: start.page,
        wordIndex: start.wordIndex,
      })),
      audio: toManifestFileDto(part.audio, urls),
      vtt: toManifestFileDto(part.vtt, urls),
    })),
  };
}
