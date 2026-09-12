declare const __brand: unique symbol;

/**
 * `Brand<T, B>` — primitive enrichie d'un tag de marque, sans coût runtime.
 *
 * Différencie au niveau du compilateur des IDs structurellement identiques :
 *
 * @example
 * type DocumentId = Brand<string, 'DocumentId'>;
 * type UserId = Brand<string, 'UserId'>;
 * const d: DocumentId = 'abc' as DocumentId; // ok
 * const u: UserId = d;                       // erreur TS : marques distinctes
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
