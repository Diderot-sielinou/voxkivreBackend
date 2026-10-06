import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Conversion absente **ou à un autre utilisateur** : même 404 (RNF-08). */
export class ConversionNotFoundError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.CONVERSION_NOT_FOUND;

  constructor(conversionId: string) {
    super(`Conversion ${conversionId} not found`, { details: { conversionId } });
  }
}
