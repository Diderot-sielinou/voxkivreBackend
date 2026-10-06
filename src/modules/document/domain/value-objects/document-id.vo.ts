import { type Brand } from '@/shared/kernel';

/** Identifiant de document : UUID v7 (ordre temporel, localité d'index). */
export type DocumentId = Brand<string, 'DocumentId'>;

export const DocumentId = {
  /** Marque un UUID déjà validé (générateur `uuidV7` ou `ParseUUIDPipe`). */
  of(raw: string): DocumentId {
    return raw as DocumentId;
  },
} as const;
