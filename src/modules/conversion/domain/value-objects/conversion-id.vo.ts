import { type Brand } from '@/shared/kernel';

/** Identifiant de conversion : UUID v7 (ordre temporel). Sert aussi de clé de réservation de quota. */
export type ConversionId = Brand<string, 'ConversionId'>;

export const ConversionId = {
  /** Marque un UUID déjà validé (générateur `uuidV7`, `ParseUUIDPipe` ou payload Zod). */
  of(raw: string): ConversionId {
    return raw as ConversionId;
  },
} as const;
