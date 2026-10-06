import { type Brand, Result } from '@/shared/kernel';

import { InvalidDocumentTitleError } from '../errors/invalid-document-title.error';

export const DOCUMENT_TITLE_MAX_LENGTH = 200;

// Caractères de contrôle C0/C1 : invisibles, cassent l'affichage et les logs.
// eslint-disable-next-line no-control-regex -- c'est précisément ce qu'on détecte
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** Titre affiché dans la bibliothèque : 1..200 caractères, espaces normalisés. */
export type DocumentTitle = Brand<string, 'DocumentTitle'>;

export const DocumentTitle = {
  of(raw: string): Result<DocumentTitle, InvalidDocumentTitleError> {
    const value = raw.trim().replaceAll(/\s+/g, ' ');
    if (value.length === 0) {
      return Result.err(new InvalidDocumentTitleError('Document title must not be empty'));
    }
    if (value.length > DOCUMENT_TITLE_MAX_LENGTH) {
      return Result.err(
        new InvalidDocumentTitleError('Document title is too long', {
          details: { maxLength: DOCUMENT_TITLE_MAX_LENGTH },
        }),
      );
    }
    if (CONTROL_CHARS.test(value)) {
      return Result.err(
        new InvalidDocumentTitleError('Document title contains control characters'),
      );
    }
    return Result.ok(value as DocumentTitle);
  },
} as const;
