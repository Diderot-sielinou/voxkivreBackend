/** Codes d'erreur du module identity (convention de routing : cf. shared/http). */
export const IDENTITY_ERROR_CODES = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  INVALID_USER_ROLE: 'INVALID_USER_ROLE',
  ACCOUNT_DELETION_CONFLICT: 'ACCOUNT_DELETION_CONFLICT',
  RECENT_LOGIN_REQUIRED: 'RECENT_LOGIN_REQUIRED',
} as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[keyof typeof IDENTITY_ERROR_CODES];
