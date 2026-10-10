import { type LibraryItem } from '@/modules/library/application/use-cases/list-library.use-case';
import { type ReadingPosition } from '@/modules/library/domain/entities/reading-position.entity';
import { type SavedReadingPosition } from '@/modules/library/domain/ports/reading-position-repository.port';
import { type CursorPage } from '@/shared/kernel';

import { type LibraryItemDto, type LibraryListResponseDto } from '../dto/library-response.dto';
import {
  type ReadingPositionResponseDto,
  type SavedReadingPositionResponseDto,
} from '../dto/reading-position-response.dto';

export function toReadingPositionDto(position: ReadingPosition): ReadingPositionResponseDto {
  return {
    conversionId: position.conversionId,
    wordIndex: position.wordIndex,
    audioMs: position.audioMs,
    recordedAt: position.recordedAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

export function toSavedReadingPositionDto(
  saved: SavedReadingPosition,
): SavedReadingPositionResponseDto {
  const { position } = saved;
  return {
    conversionId: position.conversionId,
    wordIndex: position.wordIndex,
    audioMs: position.audioMs,
    recordedAt: position.recordedAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
    applied: saved.applied,
  };
}

export function toLibraryItemDto(item: LibraryItem): LibraryItemDto {
  const { document, conversion } = item;
  return {
    status: item.status,
    progressPercent: item.progressPercent,
    document: {
      id: document.documentId,
      title: document.title,
      status: document.status,
      pageCount: document.pageCount,
      charCount: document.charCount,
      extractionError: document.extractionError,
      createdAt: document.createdAt.toISOString(),
    },
    conversion:
      conversion === null
        ? null
        : {
            id: conversion.conversionId,
            status: conversion.status,
            voiceId: conversion.voiceId,
            failureReason: conversion.failureReason,
            partCount: conversion.partCount,
            partsReady: conversion.partsReady,
            playableDurationMs: conversion.playableDurationMs,
            completedAt: conversion.completedAt?.toISOString() ?? null,
          },
    position: item.position === null ? null : toReadingPositionDto(item.position),
  };
}

export function toLibraryListResponseDto(page: CursorPage<LibraryItem>): LibraryListResponseDto {
  return { items: page.items.map((item) => toLibraryItemDto(item)), nextCursor: page.nextCursor };
}
