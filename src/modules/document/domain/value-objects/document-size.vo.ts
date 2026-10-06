import { type Brand, Result } from '@/shared/kernel';

import { InvalidDocumentSizeError } from '../errors/invalid-document-size.error';

/** Taille en octets d'un PDF, strictement positive et sous le plafond configuré. */
export type DocumentSize = Brand<number, 'DocumentSize'>;

export const DocumentSize = {
  of(raw: number, maxSizeBytes: number): Result<DocumentSize, InvalidDocumentSizeError> {
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      return Result.err(
        new InvalidDocumentSizeError('Document size must be a positive integer (bytes)'),
      );
    }
    if (raw > maxSizeBytes) {
      return Result.err(
        new InvalidDocumentSizeError('Document exceeds the maximum accepted size', {
          details: { maxSizeBytes },
        }),
      );
    }
    return Result.ok(raw as DocumentSize);
  },
} as const;
