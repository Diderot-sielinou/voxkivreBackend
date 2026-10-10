/** Codes d'erreur du module library (convention de routing : cf. shared/http). */
export const LIBRARY_ERROR_CODES = {
  /** Mêmes codes que les modules document et conversion : un message par cas côté mobile. */
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  CONVERSION_NOT_FOUND: 'CONVERSION_NOT_FOUND',
  /** 409 (table explicite de shared/http) : aucune partie n'est encore écoutable. */
  CONVERSION_NOT_READY: 'CONVERSION_NOT_READY',
  READING_POSITION_NOT_FOUND: 'READING_POSITION_NOT_FOUND',
  INVALID_READING_POSITION: 'INVALID_READING_POSITION',
  /** Une conversion du document travaille encore (ADR-0016). */
  DOCUMENT_DELETION_CONFLICT: 'DOCUMENT_DELETION_CONFLICT',
} as const;

export type LibraryErrorCode = (typeof LIBRARY_ERROR_CODES)[keyof typeof LIBRARY_ERROR_CODES];
