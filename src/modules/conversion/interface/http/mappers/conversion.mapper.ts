import { type ConversionProgress } from '@/modules/conversion/application/use-cases/get-conversion.use-case';
import { type VoiceOption } from '@/modules/conversion/application/use-cases/list-voices.use-case';
import { type Conversion } from '@/modules/conversion/domain/entities/conversion.entity';

import { type ConversionResponseDto } from '../dto/conversion-response.dto';
import { type VoiceListResponseDto } from '../dto/voice-list-response.dto';

export function toConversionResponseDto(
  conversion: Conversion,
  segmentsDone = 0,
): ConversionResponseDto {
  return {
    id: conversion.id,
    documentId: conversion.documentId,
    voiceId: conversion.voiceId,
    status: conversion.status,
    reservedChars: conversion.reservedChars,
    progress: { segmentsDone, segmentCount: conversion.segmentCount },
    failureReason: conversion.failureReason,
    createdAt: conversion.createdAt.toISOString(),
    updatedAt: conversion.updatedAt.toISOString(),
    completedAt: conversion.completedAt?.toISOString() ?? null,
  };
}

export function toConversionProgressDto(progress: ConversionProgress): ConversionResponseDto {
  return toConversionResponseDto(progress.conversion, progress.segmentsDone);
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
