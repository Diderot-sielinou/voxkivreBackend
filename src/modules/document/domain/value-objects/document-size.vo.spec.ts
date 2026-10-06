import { DOCUMENT_ERROR_CODES } from '../errors/error-codes';

import { DocumentSize } from './document-size.vo';

const MAX = 1000;

describe('DocumentSize', () => {
  it('accepts 1 byte and exactly the maximum', () => {
    expect(DocumentSize.of(1, MAX).value).toBe(1);
    expect(DocumentSize.of(MAX, MAX).value).toBe(MAX);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (raw) => {
    expect(DocumentSize.of(raw, MAX).error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_SIZE);
  });

  it('rejects above the maximum and exposes the limit to the client', () => {
    const r = DocumentSize.of(MAX + 1, MAX);
    expect(r.error.code).toBe(DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_SIZE);
    expect(r.error.details).toEqual({ maxSizeBytes: MAX });
  });
});
