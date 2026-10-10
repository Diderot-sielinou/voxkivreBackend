import { type ReadingPosition } from '@/modules/library/domain/entities/reading-position.entity';
import {
  type ReadingPositionRepositoryPort,
  type SavedReadingPosition,
} from '@/modules/library/domain/ports/reading-position-repository.port';

/** Fake du `ReadingPositionRepositoryPort` : même règle « le plus récent gagne » que l'adapter Drizzle. */
export class InMemoryReadingPositionRepository implements ReadingPositionRepositoryPort {
  readonly rows = new Map<string, ReadingPosition>();

  saveIfNewer(position: ReadingPosition): Promise<SavedReadingPosition> {
    const current = this.rows.get(position.conversionId);
    if (current !== undefined && current.recordedAt.getTime() >= position.recordedAt.getTime()) {
      return Promise.resolve({ position: current, applied: false });
    }
    this.rows.set(position.conversionId, position);
    return Promise.resolve({ position, applied: true });
  }

  findForOwner(conversionId: string, ownerId: string): Promise<ReadingPosition | null> {
    const found = this.rows.get(conversionId);
    return Promise.resolve(found?.ownerId === ownerId ? found : null);
  }

  findForConversions(
    ownerId: string,
    conversionIds: readonly string[],
  ): Promise<readonly ReadingPosition[]> {
    const wanted = new Set(conversionIds);
    return Promise.resolve(
      [...this.rows.values()].filter((p) => p.ownerId === ownerId && wanted.has(p.conversionId)),
    );
  }
}
