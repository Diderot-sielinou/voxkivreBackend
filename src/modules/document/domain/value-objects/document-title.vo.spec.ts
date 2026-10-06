import { DOCUMENT_ERROR_CODES } from '../errors/error-codes';

import { DOCUMENT_TITLE_MAX_LENGTH, DocumentTitle } from './document-title.vo';

describe('DocumentTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(DocumentTitle.of('  Cours   de\tdroit  L1 ').value).toBe('Cours de droit L1');
  });

  it.each(['', '   ', '\n\t'])('rejects a blank title (%j)', (raw) => {
    expect(DocumentTitle.of(raw).error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_TITLE);
  });

  it('accepts exactly the max length and rejects one more', () => {
    expect(DocumentTitle.of('a'.repeat(DOCUMENT_TITLE_MAX_LENGTH)).isOk()).toBe(true);
    const tooLong = DocumentTitle.of('a'.repeat(DOCUMENT_TITLE_MAX_LENGTH + 1));
    expect(tooLong.error.details).toEqual({ maxLength: DOCUMENT_TITLE_MAX_LENGTH });
  });

  it('rejects control characters', () => {
    expect(DocumentTitle.of('Livre\u0007 sonore').isErr()).toBe(true);
  });

  it('keeps accents and punctuation (French titles)', () => {
    expect(DocumentTitle.of('Éléments d’économie — tome 2 !').value).toBe(
      'Éléments d’économie — tome 2 !',
    );
  });
});
