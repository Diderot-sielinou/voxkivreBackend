export const ACCOUNT_FILES = Symbol('AccountFiles');

/** Fichiers d'un compte dans le stockage objet, implémenté par un adapter vers `library`. */
export interface AccountFilesPort {
  /**
   * Inscrit **toutes** les clés de fichiers du compte (sources pas encore
   * supprimées, fichiers des conversions) dans l'outbox de la transaction
   * `tx` (ADR-0016) ; renvoie leur nombre.
   */
  scheduleDeletion(userId: string, requestedAt: Date, tx: unknown): Promise<number>;
}
