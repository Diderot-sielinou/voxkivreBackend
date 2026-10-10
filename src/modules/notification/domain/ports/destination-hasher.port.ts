export const DESTINATION_HASHER = Symbol('DestinationHasher');

/**
 * Empreinte non réversible d'une destination (ADR-0017 §4). Un simple hash
 * ne suffit pas : un numéro camerounais (≈ 10⁸ possibilités) se retrouve
 * par force brute — il faut une clé secrète (HMAC).
 */
export interface DestinationHasherPort {
  keyOf(destination: string): string;
}
