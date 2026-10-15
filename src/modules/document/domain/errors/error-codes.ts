/** Codes d'erreur du module document (convention de routing : cf. shared/http). */
export const DOCUMENT_ERROR_CODES = {
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  INVALID_DOCUMENT_TITLE: 'INVALID_DOCUMENT_TITLE',
  INVALID_DOCUMENT_SIZE: 'INVALID_DOCUMENT_SIZE',
  INVALID_RIGHTS_ATTESTATION: 'INVALID_RIGHTS_ATTESTATION',
  INVALID_DOCUMENT_UPLOAD: 'INVALID_DOCUMENT_UPLOAD',
  /** 409 : pas d'envoi par morceaux en cours pour ce document (ADR-0029). */
  DOCUMENT_UPLOAD_CONFLICT: 'DOCUMENT_UPLOAD_CONFLICT',
  DOCUMENT_PAGE_NOT_FOUND: 'DOCUMENT_PAGE_NOT_FOUND',
  INVALID_PAGE_TEXT: 'INVALID_PAGE_TEXT',
  /** 409 (table explicite de shared/http) : le texte n'est pas (encore) disponible. */
  DOCUMENT_TEXT_NOT_READY: 'DOCUMENT_TEXT_NOT_READY',
} as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[keyof typeof DOCUMENT_ERROR_CODES];
