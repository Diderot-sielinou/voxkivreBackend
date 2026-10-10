import {
  type FileDeletionOutboxPort,
  type PendingFileDeletion,
} from '@/modules/library/domain/ports/file-deletion-outbox.port';

interface Row {
  readonly requestedAt: Date;
  attempts: number;
  lastError: string | null;
}

/** Fake du `FileDeletionOutboxPort` : clés dédoublonnées, plus anciennes d'abord. */
export class InMemoryFileDeletionOutbox implements FileDeletionOutboxPort {
  readonly rows = new Map<string, Row>();
  /** Le `tx` reçu par le dernier `add` (preuve que l'écriture rejoint la transaction). */
  lastTx: unknown = undefined;

  add(keys: readonly string[], requestedAt: Date, tx: unknown): Promise<void> {
    this.lastTx = tx;
    for (const key of keys) {
      if (!this.rows.has(key)) this.rows.set(key, { requestedAt, attempts: 0, lastError: null });
    }
    return Promise.resolve();
  }

  listPending(limit: number): Promise<readonly PendingFileDeletion[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .toSorted(([, a], [, b]) => a.requestedAt.getTime() - b.requestedAt.getTime())
        .slice(0, limit)
        .map(([key, row]) => ({ key, attempts: row.attempts })),
    );
  }

  remove(key: string): Promise<void> {
    this.rows.delete(key);
    return Promise.resolve();
  }

  recordFailure(key: string, error: string): Promise<void> {
    const row = this.rows.get(key);
    if (row !== undefined) {
      row.attempts += 1;
      row.lastError = error;
    }
    return Promise.resolve();
  }
}
