/** Codes d'erreur du module identity (convention de routing : cf. shared/http). */
export const IDENTITY_ERROR_CODES = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  INVALID_USER_ROLE: 'INVALID_USER_ROLE',
} as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[keyof typeof IDENTITY_ERROR_CODES];
