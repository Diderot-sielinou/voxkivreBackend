/**
 * Token DI du codec de cursor signé (ADR-0005). Le tri est toujours
 * sérialisé en string (date ISO 8601, …) : un seul codec pour toute l'API.
 */
export const CURSOR_CODEC = Symbol('CursorCodec');
