import { GrantOfferUseCase } from '@/modules/billing/application/use-cases/grant-offer.use-case';
import { DrizzleOfferCatalog } from '@/modules/billing/infrastructure/persistence/offer-catalog.drizzle-repository';
import { DrizzlePurchaseLedger } from '@/modules/billing/infrastructure/persistence/purchase-ledger.drizzle-repository';
import { ConversionCatalog } from '@/modules/conversion/application/services/conversion-catalog.service';
import { DrizzleConversionRepository } from '@/modules/conversion/infrastructure/persistence/conversion.drizzle-repository';
import { conversions } from '@/modules/conversion/infrastructure/persistence/schema/conversion.schema';
import { DocumentCatalog } from '@/modules/document/application/services/document-catalog.service';
import { DrizzleDocumentRepository } from '@/modules/document/infrastructure/persistence/document.drizzle-repository';
import { documents } from '@/modules/document/infrastructure/persistence/schema/document.schema';
import { FileDeletionScheduler } from '@/modules/library/application/services/file-deletion-scheduler.service';
import { DrizzleFileDeletionOutbox } from '@/modules/library/infrastructure/persistence/file-deletion-outbox.drizzle-repository';
import { PaymentActivity } from '@/modules/payment/application/services/payment-activity.service';
import { newPendingPayment, type Payment } from '@/modules/payment/domain/entities/payment.entity';
import { DrizzlePaymentRepository } from '@/modules/payment/infrastructure/persistence/payment.drizzle-repository';
import { DrizzleUnitOfWork } from '@/shared/persistence/drizzle-unit-of-work';

import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { FixedClock } from '../../../../../test/support/fakes';
import { DeleteAccountUseCase } from '../../application/use-cases/delete-account.use-case';
import { IDENTITY_ERROR_CODES } from '../../domain/errors/error-codes';
import { EXIT, runAccountDelete } from '../../interface/cli/account-delete.command';
import { user } from '../persistence/schema/auth.schema';
import { DrizzleUserAccounts } from '../persistence/user-accounts.drizzle-repository';

import { ModulesAccountActivity } from './account-activity.adapter';
import { composeAccountDeletion } from './account-deletion.composition';
import { ModulesAccountFiles } from './account-files.adapter';

const AT = new Date('2026-10-12T09:00:00Z');
const RECENT = new Date(AT.getTime() - 60_000);
const uuid = (prefix: string, n: number) =>
  `${prefix}0a00000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Refuse toute inscription : la suppression doit alors être annulée en bloc. */
class FailingScheduler extends FileDeletionScheduler {
  override schedule(): Promise<void> {
    return Promise.reject(new Error('outbox down'));
  }
}

/**
 * Contre un vrai Postgres migré (0013 compris) : la suppression du compte
 * avec les vrais adapters et services des autres modules — cascade réelle,
 * fichiers dans l'outbox, paiements et achats détachés, refus et atomicité
 * (ADR-0023).
 */
describe('account deletion (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let payments: DrizzlePaymentRepository;
  let grant: GrantOfferUseCase;
  let documentCatalog: DocumentCatalog;
  let conversionCatalog: ConversionCatalog;
  let sequence = 0;

  function useCase(scheduler?: FileDeletionScheduler): DeleteAccountUseCase {
    const files = new ModulesAccountFiles(
      documentCatalog,
      conversionCatalog,
      scheduler ?? new FileDeletionScheduler(new DrizzleFileDeletionOutbox(pg.db)),
    );
    const activity = new ModulesAccountActivity(conversionCatalog, new PaymentActivity(payments));
    return new DeleteAccountUseCase(
      new DrizzleUserAccounts(pg.db),
      activity,
      files,
      new DrizzleUnitOfWork(pg.db),
      new FixedClock(AT),
    );
  }

  async function seedUser(id: string, phoneNumber: string | null = null): Promise<void> {
    await pg.db.insert(user).values({ id, name: id, email: `${id}@x.cm`, phoneNumber });
  }

  /** Un document ; sa source est déjà effacée si `sourceDeleted`. */
  async function seedDocument(ownerId: string, sourceDeleted: boolean): Promise<string> {
    sequence += 1;
    const id = uuid('d', sequence);
    await pg.db.insert(documents).values({
      id,
      ownerId,
      title: 'Livre',
      status: 'text_ready',
      sizeBytes: 10,
      sourceKey: `documents/${ownerId}/${id}/source.pdf`,
      rightsAttestedAt: AT,
      rightsAttestationVersion: 'v1',
      pageCount: 1,
      charCount: 5,
      textRevision: 1,
      sourceDeletedAt: sourceDeleted ? AT : null,
      createdAt: AT,
      updatedAt: AT,
    });
    return id;
  }

  async function seedConversion(ownerId: string, documentId: string, status: string) {
    sequence += 1;
    const id = uuid('c', sequence);
    await pg.db.insert(conversions).values({
      id,
      ownerId,
      documentId,
      voiceId: 'fr-f1',
      textRevision: 1,
      status,
      reservedChars: 5,
      partCount: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    return id;
  }

  function payment(userId: string, overrides: Partial<Payment> = {}): Payment {
    sequence += 1;
    const n = String(sequence).padStart(12, '0');
    return {
      ...newPendingPayment({
        id: `01a11019-f2e7-7014-8369-${n}`,
        userId,
        offerCode: 'credits-s',
        amountXaf: 500,
        idempotencyKey: `key-${n}`,
        requestHash: 'c'.repeat(64),
        provider: 'campay',
        externalReference: `2ceefe04-1a79-4914-9dd0-${n}`,
        phoneHmac: 'a'.repeat(64),
        phoneSuffix: '05',
        now: AT,
      }),
      ...overrides,
    };
  }

  async function count(table: string, where: string): Promise<number> {
    const rows = await pg.sql.unsafe<{ n: string }[]>(
      `select count(*) as n from ${table} where ${where}`,
    );
    return Number(rows[0].n);
  }

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    payments = new DrizzlePaymentRepository(pg.db);
    documentCatalog = new DocumentCatalog(new DrizzleDocumentRepository(pg.db));
    conversionCatalog = new ConversionCatalog(new DrizzleConversionRepository(pg.db));
    grant = new GrantOfferUseCase(
      new DrizzleOfferCatalog(pg.db),
      new DrizzlePurchaseLedger(pg.db),
      new DrizzleUnitOfWork(pg.db),
      new FixedClock(AT),
    );
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  it('deletes everything of the account, queues its files, and keeps its payments detached', async () => {
    await seedUser('alice');
    await seedUser('bob');
    const kept = await seedDocument('alice', false);
    const converted = await seedDocument('alice', true);
    const conversion = await seedConversion('alice', converted, 'ready');
    const bobDocument = await seedDocument('bob', false);
    const paid = payment('alice', { status: 'succeeded', completedAt: AT });
    await payments.insert(paid);
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: paid.id });
    // Marque-pages et notes : données personnelles, actif et trace de suppression (ADR-0028).
    await pg.sql`insert into bookmarks (id, owner_id, document_id, page_number, word_index,
      excerpt, note, created_at, updated_at, deleted_at) values
      (${'01a11019-0000-7000-8000-0000000000b1'}, 'alice', ${kept}, 1, 0, 'Le', 'Note privée', ${AT.toISOString()}, ${AT.toISOString()}, null),
      (${'01a11019-0000-7000-8000-0000000000b2'}, 'alice', ${kept}, 1, 0, 'Le', 'Effacée', ${AT.toISOString()}, ${AT.toISOString()}, ${AT.toISOString()})`;

    const result = await useCase().execute({
      userId: 'alice',
      requestedBy: 'user',
      sessionCreatedAt: RECENT,
    });

    expect(result.isOk() && result.value).toEqual({ fileCount: 4 });
    expect(await count('bookmarks', `owner_id = 'alice'`)).toBe(0);
    const queued = await pg.sql<
      { key: string }[]
    >`select object_key as key from pending_file_deletions`;
    expect(queued.map((row) => row.key).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        `conversions/alice/${conversion}/manifest.json`,
        `conversions/alice/${conversion}/part-001.mp3`,
        `conversions/alice/${conversion}/part-001.vtt`,
        `documents/alice/${kept}/source.pdf`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(await count('"user"', `id = 'alice'`)).toBe(0);
    expect(await count('documents', `owner_id = 'alice'`)).toBe(0);
    expect(await count('conversions', `owner_id = 'alice'`)).toBe(0);
    expect(await count('wallets', `user_id = 'alice'`)).toBe(0);
    expect(await count('credit_entries', `user_id = 'alice'`)).toBe(0);
    expect(await count('payments', `id = '${paid.id}' and user_id is null`)).toBe(1);
    expect(await count('purchases', `payment_reference = '${paid.id}' and user_id is null`)).toBe(
      1,
    );
    // L'autre compte n'est pas touché.
    expect(await count('documents', `id = '${bobDocument}'`)).toBe(1);
    expect(await count('"user"', `id = 'bob'`)).toBe(1);
  });

  it('refuses while a conversion is running, and deletes nothing', async () => {
    await seedUser('carol');
    const documentId = await seedDocument('carol', false);
    await seedConversion('carol', documentId, 'synthesizing');

    const result = await useCase().execute({
      userId: 'carol',
      requestedBy: 'user',
      sessionCreatedAt: RECENT,
    });

    expect(result.error.code).toBe(IDENTITY_ERROR_CODES.ACCOUNT_DELETION_CONFLICT);
    expect(result.error.details).toEqual({ reason: 'conversion_in_progress' });
    expect(await count('"user"', `id = 'carol'`)).toBe(1);
    expect(await count('pending_file_deletions', `object_key like 'documents/carol/%'`)).toBe(0);
  });

  it('refuses while a payment is pending', async () => {
    await seedUser('dave');
    await payments.insert(payment('dave'));

    const result = await useCase().execute({
      userId: 'dave',
      requestedBy: 'user',
      sessionCreatedAt: RECENT,
    });

    expect(result.error.details).toEqual({ reason: 'payment_pending' });
    expect(await count('"user"', `id = 'dave'`)).toBe(1);
  });

  it('rolls everything back when the files cannot be queued', async () => {
    await seedUser('erin');
    await seedDocument('erin', false);

    await expect(
      useCase(new FailingScheduler(new DrizzleFileDeletionOutbox(pg.db))).execute({
        userId: 'erin',
        requestedBy: 'user',
        sessionCreatedAt: RECENT,
      }),
    ).rejects.toThrow('outbox down');

    expect(await count('"user"', `id = 'erin'`)).toBe(1);
    expect(await count('documents', `owner_id = 'erin'`)).toBe(1);
  });

  it('makes a document created during the deletion wait, then fail (row lock)', async () => {
    await seedUser('frank');
    const accounts = new DrizzleUserAccounts(pg.db);
    let insert: Promise<string> | null = null;
    await new DrizzleUnitOfWork(pg.db).withTransaction(async (tx) => {
      await accounts.lockForDeletion('frank', tx);
      insert = seedDocument('frank', false);
      // Laisse à l'insertion le temps d'atteindre le verrou.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await accounts.delete('frank', tx);
    });

    await expect(insert).rejects.toThrow();
    expect(await count('documents', `owner_id = 'frank'`)).toBe(0);
  });

  it('answers not found for an account that no longer exists', async () => {
    const result = await useCase().execute({
      userId: 'ghost',
      requestedBy: 'user',
      sessionCreatedAt: RECENT,
    });
    expect(result.error.code).toBe(IDENTITY_ERROR_CODES.USER_NOT_FOUND);
  });

  it('ops script: finds the account by e-mail or number, reports, then deletes with --yes', async () => {
    await seedUser('gina', '+237690000007');
    await seedDocument('gina', false);
    const lines: Record<string, unknown>[] = [];
    const deps = {
      ...composeAccountDeletion(pg.db, new FixedClock(AT)),
      print: (line: Readonly<Record<string, unknown>>) => lines.push({ ...line }),
    };

    // E-mail saisi en majuscules : better-auth les stocke en minuscules.
    expect(await runAccountDelete({ contact: 'GINA@x.cm', confirmed: false }, deps)).toBe(EXIT.OK);
    expect(await count('"user"', `id = 'gina'`)).toBe(1);

    expect(await runAccountDelete({ contact: '+237690000007', confirmed: true }, deps)).toBe(
      EXIT.OK,
    );
    expect(lines).toEqual([
      expect.objectContaining({ outcome: 'dry_run', userId: 'gina', blocker: null }),
      { outcome: 'deleted', userId: 'gina', fileCount: 1 },
    ]);
    expect(await count('"user"', `id = 'gina'`)).toBe(0);
    expect(await count('pending_file_deletions', `object_key like 'documents/gina/%'`)).toBe(1);
  });
});
