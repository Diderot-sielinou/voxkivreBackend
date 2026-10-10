import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import {
  type FileDeletionOutboxPort,
  type PendingFileDeletion,
} from '../../domain/ports/file-deletion-outbox.port';

import { pendingFileDeletions } from './schema/library.schema';

/** Clés écrites par paquets : borne la taille d'un INSERT (un long livre ≈ 160 fichiers). */
const KEY_INSERT_CHUNK = 500;

/** Outbox des fichiers à effacer, en SQL (ADR-0016). */
@Injectable()
export class DrizzleFileDeletionOutbox implements FileDeletionOutboxPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async add(keys: readonly string[], requestedAt: Date, tx: unknown): Promise<void> {
    const db = (tx as DrizzleClient | undefined) ?? this.db;
    for (let start = 0; start < keys.length; start += KEY_INSERT_CHUNK) {
      await db
        .insert(pendingFileDeletions)
        .values(
          keys
            .slice(start, start + KEY_INSERT_CHUNK)
            .map((objectKey) => ({ objectKey, requestedAt })),
        )
        .onConflictDoNothing({ target: pendingFileDeletions.objectKey });
    }
  }

  async listPending(limit: number): Promise<readonly PendingFileDeletion[]> {
    const rows = await this.db
      .select({ key: pendingFileDeletions.objectKey, attempts: pendingFileDeletions.attempts })
      .from(pendingFileDeletions)
      .orderBy(asc(pendingFileDeletions.requestedAt))
      .limit(limit);
    return rows;
  }

  async remove(key: string): Promise<void> {
    await this.db.delete(pendingFileDeletions).where(eq(pendingFileDeletions.objectKey, key));
  }

  async recordFailure(key: string, error: string, at: Date): Promise<void> {
    await this.db
      .update(pendingFileDeletions)
      .set({
        attempts: sql`${pendingFileDeletions.attempts} + 1`,
        lastError: error.slice(0, 100),
        lastAttemptAt: at,
      })
      .where(eq(pendingFileDeletions.objectKey, key));
  }
}
