import { HttpStatus } from '@nestjs/common';

import { ERROR_CODES } from '@/shared/kernel';

import { statusFromCode, titleFromStatus } from './error-status';

describe('statusFromCode', () => {
  it.each([
    ['NOT_FOUND', HttpStatus.NOT_FOUND],
    ['DOCUMENT_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['CONFLICT', HttpStatus.CONFLICT],
    ['CONVERSION_CONFLICT', HttpStatus.CONFLICT],
    ['PDF_PAYLOAD_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE],
    ['INVALID_CURSOR', HttpStatus.UNPROCESSABLE_ENTITY],
    ['VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY],
    ['UNAUTHORIZED', HttpStatus.UNAUTHORIZED],
    ['FORBIDDEN_OWNER_ONLY', HttpStatus.FORBIDDEN],
    ['RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS],
    ['INFRASTRUCTURE_ERROR', HttpStatus.SERVICE_UNAVAILABLE],
    ['SOMETHING_WEIRD', HttpStatus.INTERNAL_SERVER_ERROR],
  ])('%s → %i', (code, expected) => {
    expect(statusFromCode(code)).toBe(expected);
  });

  // Tout code ajouté au kernel doit résoudre vers un status ≠ 500 (un 500
  // signifie "convention non respectée").
  it.each(Object.values(ERROR_CODES))('kernel code %s is not mapped to 500', (code) => {
    expect(statusFromCode(code)).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe('titleFromStatus', () => {
  it('returns a known title', () => {
    expect(titleFromStatus(HttpStatus.NOT_FOUND)).toBe('Not Found');
  });

  it('falls back to "Error"', () => {
    expect(titleFromStatus(418)).toBe('Error');
  });
});
