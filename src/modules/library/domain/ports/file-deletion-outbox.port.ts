export const FILE_DELETION_OUTBOX = Symbol('FileDeletionOutbox');

export interface PendingFileDeletion {
  readonly key: string;
  readonly attempts: number;
}

/**
 * Outbox des fichiers à effacer (ADR-0016) : écrite dans la **même
 * transaction** que la suppression des lignes, vidée par un balayage.
 */
export interface FileDeletionOutboxPort {
  /** Ajoute les clés (doublons ignorés) dans la transaction `tx`. */
  add(keys: readonly string[], requestedAt: Date, tx: unknown): Promise<void>;

  /** Les plus anciennes en attente, au plus `limit`. */
  listPending(limit: number): Promise<readonly PendingFileDeletion[]>;

  /** Fichier effacé : la ligne disparaît. */
  remove(key: string): Promise<void>;

  /** Échec : la ligne reste (réessai au prochain balayage), essai et erreur tracés. */
  recordFailure(key: string, error: string, at: Date): Promise<void>;
}
