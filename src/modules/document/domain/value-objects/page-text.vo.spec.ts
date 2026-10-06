import { DOCUMENT_ERROR_CODES } from '../errors/error-codes';

import { PAGE_TEXT_MAX_LENGTH, PageText } from './page-text.vo';

describe('PageText', () => {
  it('trims, normalises CRLF and keeps line breaks and tabs', () => {
    expect(PageText.of('  ligne 1\r\nligne\t2  ').value).toBe('ligne 1\nligne\t2');
  });

  it('accepts an empty page (blank page, figure-only page)', () => {
    expect(PageText.of('   ').value).toBe('');
  });

  it('rejects text over the limit and other control characters', () => {
    expect(PageText.of('a'.repeat(PAGE_TEXT_MAX_LENGTH + 1)).error.code).toBe(
      DOCUMENT_ERROR_CODES.INVALID_PAGE_TEXT,
    );
    expect(PageText.of('bip\u0007').error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_PAGE_TEXT);
  });
});
