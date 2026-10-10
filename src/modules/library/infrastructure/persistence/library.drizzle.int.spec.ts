import { eq } from 'drizzle-orm';

import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { DrizzleConversionRepository } from '@/modules/conversion/infrastructure/persistence/conversion.drizzle-repository';
import {
  conversionParts,
  conversions,
} from '@/modules/conversion/infrastructure/persistence/schema/conversion.schema';
import { DocumentCatalog } from '@/modules/document/application/services/document-catalog.service';
import { DrizzleDocumentRepository } from '@/modules/document/infrastructure/persistence/document.drizzle-repository';
import {
  documentPages,
  documents,
} from '@/modules/document/infrastructure/persistence/schema/document.schema';
import { user } from '@/modules/identity/infrastructure/persistence/schema/auth.schema';
import { DrizzleUnitOfWork } from '@/shared/persistence/drizzle-unit-of-work';

import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { FakeObjectStorage, FixedClock } from '../../../../../test/support/fakes';
import { DeleteDocumentUseCase } from '../../application/use-cases/delete-document.use-case';
import { PurgePendingFileDeletionsUseCase } from '../../application/use-cases/purge-pending-file-deletions.use-case';
import { type FileDeletionOutboxPort } from '../../domain/ports/file-deletion-outbox.port';
import { ConversionModuleLibraryConversions } from '../conversion/library-conversions.adapter';
import { DocumentModuleLibraryDocuments } from '../document/library-documents.adapter';

import { DrizzleFileDeletionOutbox } from './file-deletion-outbox.drizzle-repository';
import { DrizzleReadingPositionRepository } from './reading-position.drizzle-repository';
import { pendingFileDeletions, readingPositions } from './schema/library.schema';

const AT = new Date('2026-10-10T10:00:00Z');
const minutes = (n: number) => new Date(AT.getTime() + n * 60_000);

/**
 * Contre un vrai Postgres migré (0007) : « le plus récent gagne » en SQL,
 * lectures groupées de la bibliothèque, cascades réelles et surtout
 * l'**atomicité** de la suppression (ADR-0016) — si l'outbox échoue, le
 * document reste.
 */
describe('library persistence (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let positions: DrizzleReadingPositionRepository;
  let outbox: DrizzleFileDeletionOutbox;
  let conversionCatalog: ConversionCatalog;
  let libraryDocuments: DocumentModuleLibraryDocuments;
  let libraryConversions: ConversionModuleLibraryConversions;

  async function seedBook(documentId: string, conversionId: string, status: string) {
    await pg.db.insert(documents).values({
      id: documentId,
      ownerId: 'alice',
      title: 'Livre',
      status: 'text_ready',
      sizeBytes: 10,
      sourceKey: `documents/alice/${documentId}/source.pdf`,
      rightsAttestedAt: AT,
      rightsAttestationVersion: 'v1',
      pageCount: 1,
      charCount: 5,
      textRevision: 1,
      sourceDeletedAt: null,
      createdAt: AT,
      updatedAt: AT,
    });
    await pg.db
      .insert(documentPages)
      .values({ documentId, pageNumber: 1, text: 'Hello', charCount: 5, updatedAt: AT });
    await pg.db.insert(conversions).values({
      id: conversionId,
      ownerId: 'alice',
      documentId,
      voiceId: 'fr-f1',
      textRevision: 1,
      status,
      reservedChars: 5,
      partCount: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    await pg.db.insert(conversionParts).values({
      conversionId,
      partIndex: 0,
      firstSegment: 0,
      lastSegment: 0,
      firstWordIndex: 0,
      // Comme `completePart` : clés de fichiers et assemblage écrits ensemble.
      audioKey: `conversions/alice/${conversionId}/part-001.mp3`,
      vttKey: `conversions/alice/${conversionId}/part-001.vtt`,
      durationMs: 60_000,
      wordCount: 100,
      assembledAt: AT,
    });
  }

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    await pg.db.insert(user).values([
      { id: 'alice', name: 'Alice', email: 'alice@x.cm' },
      { id: 'bob', name: 'Bob', email: 'bob@x.cm' },
    ]);
    positions = new DrizzleReadingPositionRepository(pg.db);
    outbox = new DrizzleFileDeletionOutbox(pg.db);
    conversionCatalog = new ConversionCatalog(new DrizzleConversionRepository(pg.db));
    libraryDocuments = new DocumentModuleLibraryDocuments(
      new DocumentCatalog(new DrizzleDocumentRepository(pg.db)),
    );
    libraryConversions = new ConversionModuleLibraryConversions(conversionCatalog);
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.db.delete(pendingFileDeletions);
    await pg.db.delete(documents); // cascade : pages, conversions, parties, positions
  });

  const position = (
    wordIndex: number,
    recordedAt: Date,
    conversionId = 'c0a00000-0000-7000-8000-000000000001',
  ) => ({
    conversionId,
    ownerId: 'alice',
    wordIndex,
    audioMs: wordIndex * 100,
    recordedAt,
    updatedAt: AT,
  });

  it('keeps the newest position: an older or identical one is not written', async () => {
    await seedBook(
      'd0a00000-0000-7000-8000-000000000001',
      'c0a00000-0000-7000-8000-000000000001',
      'ready',
    );

    const first = await positions.saveIfNewer(position(50, minutes(10)));
    expect(first.applied).toBe(true);
    const older = await positions.saveIfNewer(position(5, minutes(1)));
    expect(older).toMatchObject({ applied: false, position: { wordIndex: 50 } });
    const same = await positions.saveIfNewer(position(7, minutes(10)));
    expect(same).toMatchObject({ applied: false, position: { wordIndex: 50 } });
    const newer = await positions.saveIfNewer(position(60, minutes(11)));
    expect(newer).toMatchObject({ applied: true, position: { wordIndex: 60 } });

    expect(await positions.findForOwner('c0a00000-0000-7000-8000-000000000001', 'bob')).toBeNull();
    const many = await positions.findForConversions('alice', [
      'c0a00000-0000-7000-8000-000000000001',
    ]);
    expect(many.map((p) => p.wordIndex)).toEqual([60]);
  });

  it('reads the library in bulk: retained conversion and playable extent', async () => {
    await seedBook(
      'd0a00000-0000-7000-8000-000000000001',
      'c0a00000-0000-7000-8000-000000000001',
      'ready',
    );
    const page = await libraryDocuments.listForOwner('alice', null, 10);
    expect(page.map((d) => [d.documentId, d.state])).toEqual([
      ['d0a00000-0000-7000-8000-000000000001', 'text_ready'],
    ]);
    const byDocument = await libraryConversions.forDocuments('alice', [
      'd0a00000-0000-7000-8000-000000000001',
    ]);
    expect(byDocument.get('d0a00000-0000-7000-8000-000000000001')).toMatchObject({
      state: 'ready',
      partsReady: 1,
      playableWordCount: 100,
      playableDurationMs: 60_000,
    });
  });

  it('deletes the book and everything under it, and queues its files, atomically', async () => {
    const doc = 'd0a00000-0000-7000-8000-000000000001';
    const conv = 'c0a00000-0000-7000-8000-000000000001';
    await seedBook(doc, conv, 'ready');
    await positions.saveIfNewer(position(10, AT, conv));
    const useCase = new DeleteDocumentUseCase(
      libraryDocuments,
      libraryConversions,
      outbox,
      new DrizzleUnitOfWork(pg.db),
      new FixedClock(AT),
    );

    const result = await useCase.execute({ ownerId: 'alice', documentId: doc });

    expect(result.isOk() && result.value.fileCount).toBe(4);
    expect(await pg.db.select().from(documents)).toEqual([]);
    expect(await pg.db.select().from(documentPages)).toEqual([]);
    expect(await pg.db.select().from(conversions)).toEqual([]);
    expect(await pg.db.select().from(conversionParts)).toEqual([]);
    expect(await pg.db.select().from(readingPositions)).toEqual([]);
    const queued = await pg.db
      .select({ key: pendingFileDeletions.objectKey })
      .from(pendingFileDeletions);
    expect(queued.map((r) => r.key).toSorted((x, y) => x.localeCompare(y))).toEqual([
      `conversions/alice/${conv}/manifest.json`,
      `conversions/alice/${conv}/part-001.mp3`,
      `conversions/alice/${conv}/part-001.vtt`,
      `documents/alice/${doc}/source.pdf`,
    ]);
  });

  it('rolls the deletion back when the outbox cannot be written', async () => {
    const doc = 'd0a00000-0000-7000-8000-000000000001';
    await seedBook(doc, 'c0a00000-0000-7000-8000-000000000001', 'ready');
    const brokenOutbox: FileDeletionOutboxPort = {
      add: () => Promise.reject(new Error('outbox down')),
      listPending: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      recordFailure: () => Promise.resolve(),
    };
    const useCase = new DeleteDocumentUseCase(
      libraryDocuments,
      libraryConversions,
      brokenOutbox,
      new DrizzleUnitOfWork(pg.db),
      new FixedClock(AT),
    );

    await expect(useCase.execute({ ownerId: 'alice', documentId: doc })).rejects.toThrow(
      'outbox down',
    );
    const still = await pg.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, doc));
    expect(still).toHaveLength(1);
  });

  it('refuses while a conversion is running, and hides foreign documents', async () => {
    const doc = 'd0a00000-0000-7000-8000-000000000001';
    await seedBook(doc, 'c0a00000-0000-7000-8000-000000000001', 'synthesizing');
    const useCase = new DeleteDocumentUseCase(
      libraryDocuments,
      libraryConversions,
      outbox,
      new DrizzleUnitOfWork(pg.db),
      new FixedClock(AT),
    );
    const running = await useCase.execute({ ownerId: 'alice', documentId: doc });
    expect(running.isErr() && running.error.code).toBe('DOCUMENT_DELETION_CONFLICT');
    const foreign = await useCase.execute({ ownerId: 'bob', documentId: doc });
    expect(foreign.isErr() && foreign.error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(await pg.db.select({ id: documents.id }).from(documents)).toHaveLength(1);
  });

  it('drains the outbox, keeping rows (with attempts) while the storage is down', async () => {
    await outbox.add(['a.mp3', 'b.vtt', 'a.mp3'], AT, undefined);
    const storage = new FakeObjectStorage();
    storage.seed('a.mp3', 'audio');
    const purge = new PurgePendingFileDeletionsUseCase(outbox, storage, new FixedClock(AT));

    storage.failing = true;
    expect(await purge.execute()).toEqual({ deleted: 0, failed: 2 });
    const traced = await pg.db
      .select({
        attempts: pendingFileDeletions.attempts,
        lastError: pendingFileDeletions.lastError,
      })
      .from(pendingFileDeletions)
      .where(eq(pendingFileDeletions.objectKey, 'a.mp3'));
    expect(traced).toEqual([{ attempts: 1, lastError: 'StorageUnavailableError' }]);

    storage.failing = false;
    expect(await purge.execute()).toEqual({ deleted: 2, failed: 0 });
    expect(storage.objects.has('a.mp3')).toBe(false);
    expect(await outbox.listPending(10)).toEqual([]);
  });
});
