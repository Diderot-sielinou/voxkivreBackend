export const UNIT_OF_WORK = Symbol('UnitOfWork');

/**
 * Contexte de transaction opaque. Le type concret est interne à l'adapter
 * (client transactionnel Drizzle) — les use-cases le traitent comme une
 * valeur à propager aux repositories.
 */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- alias documentaire
export type TxContext = unknown;

export interface UnitOfWorkPort {
  /**
   * Exécute `fn` dans une transaction : commit si la promesse résout,
   * rollback si elle reject. Les repositories appelés depuis `fn` reçoivent
   * le `tx` et l'utilisent à la place de leur client par défaut.
   *
   * Cas Voxlivre typique : "débiter le quota ET créer la conversion" doit
   * être atomique — sinon un crash entre les deux facture sans livrer.
   */
  withTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}
