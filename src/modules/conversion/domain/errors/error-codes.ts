/** Codes d'erreur du module conversion (convention de routing : cf. shared/http). */
export const CONVERSION_ERROR_CODES = {
  CONVERSION_NOT_FOUND: 'CONVERSION_NOT_FOUND',
  /** 409 (table explicite de shared/http) : aucune partie n'est encore écoutable. */
  CONVERSION_NOT_READY: 'CONVERSION_NOT_READY',
  INVALID_VOICE: 'INVALID_VOICE',
  /** Le texte du document ne contient aucun caractère à lire. */
  INVALID_CONVERSION_TEXT: 'INVALID_CONVERSION_TEXT',
  /** Mêmes codes que le module document : le mobile n'a qu'un message par cas. */
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  DOCUMENT_TEXT_NOT_READY: 'DOCUMENT_TEXT_NOT_READY',
  /** Course entre deux lancements identiques (index unique) : jamais renvoyé au client. */
  CONVERSION_CONFLICT: 'CONVERSION_CONFLICT',
  /** Moteur TTS indisponible (réseau, 5xx, quota fournisseur) : nouvel essai. */
  TTS_UNAVAILABLE: 'INFRASTRUCTURE_TTS_UNAVAILABLE',
  /** Le moteur refuse la requête (SSML, paramètres) : réessayer ne changera rien. */
  TTS_REQUEST_REJECTED: 'TTS_REQUEST_REJECTED',
} as const;

export type ConversionErrorCode =
  (typeof CONVERSION_ERROR_CODES)[keyof typeof CONVERSION_ERROR_CODES];
