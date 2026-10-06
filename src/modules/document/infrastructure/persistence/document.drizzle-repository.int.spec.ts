import { uuidV7 } from '@/shared/kernel';

import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import {
  markUploaded,
  newDocumentAwaitingUpload,
  type Document,
} from '../../domain/entities/document.entity';
import { type DocumentPagePosition } from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { DrizzleDocumentRepository } from './document.drizzle-repository';

const ALICE = OwnerId.of('alice');
const BOB = OwnerId.of('bob');

function makeDoc(ownerId: OwnerId, createdAt: Date, title = 'Doc'): Document {
  return newDocumentAwaitingUpload({
    id: DocumentId.of(uuidV7()),
    ownerId,
    title: title as DocumentTitle,
    sizeBytes: 100 as DocumentSize,
    now: createdAt,
  });
}

/**
 * Contre un vrai Postgres migré (migrations du repo) : contraintes, keyset
 * pagination, suppression conditionnelle.
 */
describe('DrizzleDocumentRepository (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let repo: DrizzleDocumentRepository;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    repo = new DrizzleDocumentRepository(pg.db);
    await pg.db.insert(user).values([
      { id: ALICE, name: 'Alice', email: 'alice@x.cm' },
      { id: BOB, name: 'Bob', email: 'bob@x.cm' },
    ]);
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.sql`delete from documents`;
  });

  it('round-trips a document and filters by owner', async () => {
    const doc = makeDoc(ALICE, new Date('2026-10-01T00:00:00Z'));
    await repo.insert(doc);
    expect(await repo.findByIdForOwner(doc.id, ALICE)).toEqual(doc);
    expect(await repo.findByIdForOwner(doc.id, BOB)).toBeNull();
  });

  it('markUploaded moves awaiting_upload → uploaded once', async () => {
    const doc = makeDoc(ALICE, new Date('2026-10-01T00:00:00Z'));
    await repo.insert(doc);
    const at = new Date('2026-10-01T00:05:00Z');
    await repo.markUploaded(doc.id, at);
    await repo.markUploaded(doc.id, new Date('2026-10-02T00:00:00Z')); // sans effet
    expect(await repo.findByIdForOwner(doc.id, ALICE)).toMatchObject({
      status: DocumentStatus.UPLOADED,
      uploadedAt: at,
      updatedAt: at,
    });
  });

  it('pages uploaded documents newest-first with a stable (created_at, id) keyset', async () => {
    const sameInstant = new Date('2026-10-01T12:00:00Z');
    const docs = [
      makeDoc(ALICE, new Date('2026-10-01T10:00:00Z'), 'oldest'),
      makeDoc(ALICE, sameInstant, 'tie-1'),
      makeDoc(ALICE, sameInstant, 'tie-2'),
      makeDoc(ALICE, new Date('2026-10-01T14:00:00Z'), 'newest'),
    ];
    for (const d of docs) await repo.insert(markUploaded(d, d.createdAt));
    await repo.insert(makeDoc(ALICE, new Date('2026-10-01T15:00:00Z'), 'pending'));
    await repo.insert(markUploaded(makeDoc(BOB, sameInstant, 'bob'), sameInstant));

    const seen: string[] = [];
    let after: DocumentPagePosition | null = null;
    for (;;) {
      const page = await repo.listUploadedByOwner(ALICE, after, 2);
      if (page.length === 0) break;
      seen.push(...page.map((d) => d.title));
      const last = page.at(-1);
      if (last === undefined) break;
      after = { createdAt: last.createdAt, id: last.id };
    }
    expect(seen).toHaveLength(4);
    expect(seen[0]).toBe('newest');
    expect(seen.at(-1)).toBe('oldest');
    expect(seen.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'newest',
      'oldest',
      'tie-1',
      'tie-2',
    ]);
  });

  it('finds abandoned uploads and deletes them only while still awaiting_upload', async () => {
    const old = makeDoc(ALICE, new Date('2026-09-01T00:00:00Z'));
    const recent = makeDoc(ALICE, new Date('2026-10-05T00:00:00Z'));
    const confirmed = markUploaded(makeDoc(ALICE, new Date('2026-09-01T00:00:00Z')), new Date());
    for (const d of [old, recent, confirmed]) await repo.insert(d);

    const abandoned = await repo.findAbandonedUploads(new Date('2026-10-01T00:00:00Z'), 10);
    expect(abandoned).toEqual([{ id: old.id, sourceKey: old.sourceKey }]);

    expect(await repo.deleteIfAwaitingUpload(old.id)).toBe(true);
    expect(await repo.deleteIfAwaitingUpload(confirmed.id)).toBe(false);
    expect(await repo.findByIdForOwner(confirmed.id, ALICE)).not.toBeNull();
  });

  it('enforces the database constraints (status, size, unique key, owner FK)', async () => {
    const doc = makeDoc(ALICE, new Date());
    await expect(repo.insert({ ...doc, status: 'bogus' as DocumentStatus })).rejects.toThrow();
    await expect(repo.insert({ ...doc, sizeBytes: 0 as DocumentSize })).rejects.toThrow();
    await expect(repo.insert(makeDoc(OwnerId.of('ghost'), new Date()))).rejects.toThrow();
    await repo.insert(doc);
    await expect(
      repo.insert({ ...makeDoc(ALICE, new Date()), sourceKey: doc.sourceKey }),
    ).rejects.toThrow();
  });

  it('cascades deletion when the user account is deleted', async () => {
    const doc = makeDoc(BOB, new Date());
    await repo.insert(doc);
    await pg.sql`delete from "user" where id = ${BOB}`;
    expect(await repo.findByIdForOwner(doc.id, BOB)).toBeNull();
  });
});
