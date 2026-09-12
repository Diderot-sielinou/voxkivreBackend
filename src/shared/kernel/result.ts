/**
 * `Result<T, E>` — succès typé ou erreur typée, sans throw.
 *
 * Pourquoi : les use-cases renvoient leurs erreurs métier dans le type de
 * retour (cf. ADR-0001). Aucun `throw new Error` dans `domain/` ni
 * `application/` : on remonte une `DomainError` via `Result.err`, et c'est
 * la couche `interface/` (filter HTTP) qui la traduit en status.
 */
export class Result<T, E> {
  private constructor(
    private readonly _ok: boolean,
    private readonly _value: T | undefined,
    private readonly _error: E | undefined,
  ) {}

  static ok<E = never>(): Result<void, E>;
  static ok<T, E = never>(value: T): Result<T, E>;
  static ok<T, E = never>(value?: T): Result<T, E> {
    return new Result<T, E>(true, value, undefined);
  }

  static err<T = never, E = unknown>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error);
  }

  isOk(): boolean {
    return this._ok;
  }

  isErr(): boolean {
    return !this._ok;
  }

  /** Valeur d'un Ok. Throw sur un Err — toujours guard avec `isOk()` avant. */
  get value(): T {
    if (!this._ok) {
      throw new Error('Result.value accessed on an Err — guard with isOk() first.');
    }
    return this._value as T;
  }

  /** Erreur d'un Err. Throw sur un Ok — toujours guard avec `isErr()` avant. */
  get error(): E {
    if (this._ok) {
      throw new Error('Result.error accessed on an Ok — guard with isErr() first.');
    }
    return this._error as E;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this._ok) return Result.ok(fn(this._value as T));
    return Result.err(this._error as E);
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    if (this._ok) return Result.ok(this._value as T);
    return Result.err(fn(this._error as E));
  }

  /** Renvoie la valeur ou throw. À réserver aux cas où l'Err est impossible. */
  unwrap(): T {
    return this.value;
  }

  unwrapOr(defaultValue: T): T {
    return this._ok ? (this._value as T) : defaultValue;
  }
}
