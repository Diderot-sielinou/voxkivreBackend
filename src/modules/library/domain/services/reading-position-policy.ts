import { Result } from '@/shared/kernel';

import {
  InvalidReadingPositionError,
  InvalidReadingPositionReason,
} from '../errors/invalid-reading-position.error';

/** Dérive d'horloge tolérée entre l'appareil et le serveur (ADR-0015). */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Marge sur la fin de l'audio : le lecteur peut rapporter quelques
 * millisecondes de plus que la durée calculée (arrondis des trames MP3).
 */
export const AUDIO_END_TOLERANCE_MS = 1000;

export interface ReadingPositionInput {
  readonly wordIndex: number;
  readonly audioMs: number;
  readonly recordedAt: Date;
}

export interface PlayableBounds {
  readonly playableWordCount: number;
  readonly playableDurationMs: number;
}

/**
 * Une position doit tomber dans ce qui est écoutable, et ne pas venir du
 * futur (RF-19, ADR-0015 §3). Les bornes basses (entiers ≥ 0) sont vérifiées
 * par le DTO.
 */
export function validateReadingPosition(
  input: ReadingPositionInput,
  bounds: PlayableBounds,
  now: Date,
): Result<ReadingPositionInput, InvalidReadingPositionError> {
  if (input.wordIndex >= bounds.playableWordCount) {
    return Result.err(
      new InvalidReadingPositionError(InvalidReadingPositionReason.WORD_OUT_OF_RANGE, {
        wordIndex: input.wordIndex,
        playableWordCount: bounds.playableWordCount,
      }),
    );
  }
  if (input.audioMs > bounds.playableDurationMs + AUDIO_END_TOLERANCE_MS) {
    return Result.err(
      new InvalidReadingPositionError(InvalidReadingPositionReason.AUDIO_OUT_OF_RANGE, {
        audioMs: input.audioMs,
        playableDurationMs: bounds.playableDurationMs,
      }),
    );
  }
  if (input.recordedAt.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) {
    return Result.err(
      new InvalidReadingPositionError(InvalidReadingPositionReason.RECORDED_IN_FUTURE, {
        recordedAt: input.recordedAt.toISOString(),
      }),
    );
  }
  return Result.ok(input);
}
