import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type ReadingPosition } from '../../domain/entities/reading-position.entity';
import {
  type ReadingPositionRepositoryPort,
  type SavedReadingPosition,
} from '../../domain/ports/reading-position-repository.port';

import { readingPositions } from './schema/library.schema';

/** Colonnes explicites (jamais `SELECT *`, performance-rules.md). */
const POSITION_COLUMNS = {
  conversionId: readingPositions.conversionId,
  ownerId: readingPositions.ownerId,
  wordIndex: readingPositions.wordIndex,
  audioMs: readingPositions.audioMs,
  recordedAt: readingPositions.recordedAt,
  updatedAt: readingPositions.updatedAt,
};

/** Positions de lecture en SQL (ADR-0015). */
@Injectable()
export class DrizzleReadingPositionRepository implements ReadingPositionRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async saveIfNewer(position: ReadingPosition): Promise<SavedReadingPosition> {
    // Une instruction : insertion, ou mise à jour SEULEMENT si la position
    // connue est plus ancienne. Deux appareils simultanés ne peuvent pas
    // faire reculer la lecture (verrou de ligne de l'upsert).
    const written = await this.db
      .insert(readingPositions)
      .values(position)
      .onConflictDoUpdate({
        target: readingPositions.conversionId,
        set: {
          wordIndex: sql`excluded.word_index`,
          audioMs: sql`excluded.audio_ms`,
          recordedAt: sql`excluded.recorded_at`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`${readingPositions.recordedAt} < excluded.recorded_at
          AND ${readingPositions.ownerId} = excluded.owner_id`,
      })
      .returning(POSITION_COLUMNS);
    const row = written.at(0);
    if (row !== undefined) return { position: row, applied: true };

    // Rien écrit : une position plus récente (ou identique) existe déjà.
    const current = await this.findForOwner(position.conversionId, position.ownerId);
    if (current === null) {
      // Impossible sauf ligne d'un autre propriétaire : le use-case vérifie la conversion avant.
      throw new Error(`Reading position of ${position.conversionId} belongs to another owner`);
    }
    return { position: current, applied: false };
  }

  async findForOwner(conversionId: string, ownerId: string): Promise<ReadingPosition | null> {
    const rows = await this.db
      .select(POSITION_COLUMNS)
      .from(readingPositions)
      .where(
        and(eq(readingPositions.conversionId, conversionId), eq(readingPositions.ownerId, ownerId)),
      )
      .limit(1);
    return rows.at(0) ?? null;
  }

  async findForConversions(
    ownerId: string,
    conversionIds: readonly string[],
  ): Promise<readonly ReadingPosition[]> {
    if (conversionIds.length === 0) return [];
    return this.db
      .select(POSITION_COLUMNS)
      .from(readingPositions)
      .where(
        and(
          eq(readingPositions.ownerId, ownerId),
          inArray(readingPositions.conversionId, [...conversionIds]),
        ),
      );
  }
}
