import { type DomainError, type Result } from '@/shared/kernel';

/** Valeur d'un `Result` attendu en succès (le test échoue sinon). */
export async function valueOf<T, E>(pending: Promise<Result<T, E>>): Promise<T> {
  const result = await pending;
  return result.value;
}

/** Code de l'erreur d'un `Result` attendu en échec (le test échoue sinon). */
export async function errorCodeOf<T>(pending: Promise<Result<T, DomainError>>): Promise<string> {
  const result = await pending;
  return result.error.code;
}
