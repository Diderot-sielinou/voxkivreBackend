import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { newDocumentAwaitingUpload } from '../../../document/domain/entities/document.entity';
import { DocumentId } from '../../../document/domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../../document/domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../../document/domain/value-objects/document-title.vo';
import { OwnerId } from '../../../document/domain/value-objects/owner-id.vo';
import { DrizzleDocumentRepository } from '../../../document/infrastructure/persistence/document.drizzle-repository';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import { type Bookmark } from '../../domain/entities/bookmark.entity';

import { DrizzleBookmarkRepository } from './bookmark.drizzle-repository';

const T0 = new Date('2026-10-12T10:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';

/** Contre un vrai Postgres migré : « le plus récent gagne » en une instruction, cascade. */
describe('DrizzleBookmarkRepository (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let repo: DrizzleBookmarkRepository;

  const bookmark = (id: string, overrides: Partial<Bookmark> = {}): Bookmark => ({
    id,
    ownerId: 'alice',
    documentId: DOC,
    pageNumber: 2,
    wordIndex: 3,
    excerpt: 'le consentement des parties',
    note: 'Note',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  });

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    repo = new DrizzleBookmarkRepository(pg.db);
    await pg.db.insert(user).values({ id: 'alice', name: 'Alice', email: 'alice@x.cm' });
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.sql`delete from documents`;
    await new DrizzleDocumentRepository(pg.db).insert(
      newDocumentAwaitingUpload({
        id: DocumentId.of(DOC),
        ownerId: OwnerId.of('alice'),
        title: 'Cours' as DocumentTitle,
        sizeBytes: 10 as DocumentSize,
        now: T0,
      }),
    );
  });

  it('creates once per id, then keeps the latest change per bookmark', async () => {
    const id = '01a11019-0000-7000-8000-0000000000a1';
    expect(await repo.insert(bookmark(id))).toBe(true);
    expect(await repo.insert(bookmark(id, { note: 'rejoué' }))).toBe(false);

    const newer = await repo.applyChange(id, 'alice', DOC, {
      kind: 'edit',
      note: 'v2',
      at: at(10),
    });
    const older = await repo.applyChange(id, 'alice', DOC, { kind: 'edit', note: 'v1', at: at(5) });

    expect(newer).toMatchObject({ note: 'v2', updatedAt: at(10) });
    expect(older).toMatchObject({ note: 'v2', updatedAt: at(10) });
  });

  it('keeps a deletion against an older edit, and lets a newer edit bring it back', async () => {
    const id = '01a11019-0000-7000-8000-0000000000a2';
    await repo.insert(bookmark(id));
    await repo.applyChange(id, 'alice', DOC, { kind: 'delete', at: at(10) });

    expect(
      await repo.applyChange(id, 'alice', DOC, { kind: 'edit', note: 'B', at: at(5) }),
    ).toMatchObject({
      deletedAt: at(10),
    });
    expect(await repo.listActive(DOC, 'alice')).toEqual([]);
    expect(await repo.countActive(DOC, 'alice')).toBe(0);

    await repo.applyChange(id, 'alice', DOC, { kind: 'edit', note: 'rétabli', at: at(15) });
    const active = await repo.listActive(DOC, 'alice');
    expect(active.map((b) => b.note)).toEqual(['rétabli']);
  });

  it('lists the active ones by page then word, and ignores another owner', async () => {
    await repo.insert(
      bookmark('01a11019-0000-7000-8000-0000000000a3', { pageNumber: 3, wordIndex: 0 }),
    );
    await repo.insert(
      bookmark('01a11019-0000-7000-8000-0000000000a4', { pageNumber: 1, wordIndex: 9 }),
    );
    await repo.insert(
      bookmark('01a11019-0000-7000-8000-0000000000a5', { pageNumber: 1, wordIndex: 2 }),
    );

    const active = await repo.listActive(DOC, 'alice');

    expect(active.map((b) => [b.pageNumber, b.wordIndex])).toEqual([
      [1, 2],
      [1, 9],
      [3, 0],
    ]);
    expect(await repo.listActive(DOC, 'bob')).toEqual([]);
    expect(
      await repo.applyChange('01a11019-0000-7000-8000-0000000000a3', 'bob', DOC, {
        kind: 'delete',
        at: at(30),
      }),
    ).toBeNull();
  });

  it('goes away with its document, tombstones included', async () => {
    await repo.insert(bookmark('01a11019-0000-7000-8000-0000000000a6'));
    await repo.insert(bookmark('01a11019-0000-7000-8000-0000000000a7', { deletedAt: T0 }));
    await pg.sql`delete from documents where id = ${DOC}`;

    const rows = await pg.sql`select count(*)::int as n from bookmarks`;
    expect(rows[0].n).toBe(0);
  });
});
