import { type Brand, Result } from '@/shared/kernel';

import { InvalidPageTextError } from '../errors/invalid-page-text.error';

/** Plafond d'une page corrigée : ~5 pages denses, bien au-delà d'une vraie page. */
export const PAGE_TEXT_MAX_LENGTH = 20_000;

// Contrôles interdits, sauf tabulation et saut de ligne (structure de la page).
// eslint-disable-next-line no-control-regex -- c'est précisément ce qu'on détecte
const FORBIDDEN_CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/** Texte d'une page corrigé par l'utilisateur (RF-06). Une page peut devenir vide. */
export type PageText = Brand<string, 'PageText'>;

export const PageText = {
  of(raw: string): Result<PageText, InvalidPageTextError> {
    const value = raw.replaceAll('\r\n', '\n').trim();
    if (value.length > PAGE_TEXT_MAX_LENGTH) {
      return Result.err(
        new InvalidPageTextError('Page text is too long', {
          details: { maxLength: PAGE_TEXT_MAX_LENGTH },
        }),
      );
    }
    if (FORBIDDEN_CONTROL_CHARS.test(value)) {
      return Result.err(new InvalidPageTextError('Page text contains control characters'));
    }
    return Result.ok(value as PageText);
  },
} as const;
