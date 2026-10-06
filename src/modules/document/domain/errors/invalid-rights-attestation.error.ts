import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/** L'utilisateur n'a pas attesté ses droits d'usage sur le document (RNF-24). */
export class InvalidRightsAttestationError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.INVALID_RIGHTS_ATTESTATION;

  constructor() {
    super('The user must attest their rights to use the imported document');
  }
}
