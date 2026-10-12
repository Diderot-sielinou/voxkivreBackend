import { FixedClock, ImmediateUnitOfWork } from '../../../../../test/support/fakes';
import {
  InMemoryUserAccounts,
  StubAccountActivity,
  StubAccountFiles,
} from '../../../../../test/support/fakes/account-deletion-stubs';
import { IDENTITY_ERROR_CODES } from '../../domain/errors/error-codes';

import { DeleteAccountUseCase } from './delete-account.use-case';

const NOW = new Date('2026-10-12T09:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const TX = ImmediateUnitOfWork.TX;

describe('DeleteAccountUseCase', () => {
  let accounts: InMemoryUserAccounts;
  let activity: StubAccountActivity;
  let files: StubAccountFiles;
  let uow: ImmediateUnitOfWork;
  let useCase: DeleteAccountUseCase;

  beforeEach(() => {
    accounts = new InMemoryUserAccounts();
    accounts.users.add('alice');
    activity = new StubAccountActivity();
    files = new StubAccountFiles();
    files.filesByUser.set('alice', ['documents/alice/d1.pdf', 'conversions/alice/c1/part-1.mp3']);
    uow = new ImmediateUnitOfWork();
    useCase = new DeleteAccountUseCase(accounts, activity, files, uow, new FixedClock(NOW));
  });

  it('deletes the user and queues all their files in one transaction', async () => {
    const result = await useCase.execute({
      userId: 'alice',
      requestedBy: 'user',
      sessionCreatedAt: minutesAgo(3),
    });

    expect(result.isOk() && result.value).toEqual({ fileCount: 2 });
    expect(accounts.users.has('alice')).toBe(false);
    expect(files.scheduled).toEqual([
      { key: 'documents/alice/d1.pdf', at: NOW, tx: TX },
      { key: 'conversions/alice/c1/part-1.mp3', at: NOW, tx: TX },
    ]);
    expect(uow.calls).toBe(1);
    expect([...accounts.txSeen, ...activity.txSeen]).toEqual([TX, TX, TX]);
  });

  it('accepts a session opened exactly 10 minutes ago, refuses one a second older (403)', async () => {
    const limit = await useCase.execute({
      userId: 'alice',
      requestedBy: 'user',
      sessionCreatedAt: minutesAgo(10),
    });
    expect(limit.isOk()).toBe(true);

    accounts.users.add('bob');
    const stale = await useCase.execute({
      userId: 'bob',
      requestedBy: 'user',
      sessionCreatedAt: new Date(minutesAgo(10).getTime() - 1000),
    });
    expect(stale.error.code).toBe(IDENTITY_ERROR_CODES.RECENT_LOGIN_REQUIRED);
    expect(stale.error.details).toEqual({ maxAgeSeconds: 600 });
    expect(accounts.users.has('bob')).toBe(true);
    expect(uow.calls).toBe(1);
  });

  it.each(['conversion_in_progress', 'payment_pending'] as const)(
    'refuses while %s (409), and touches nothing',
    async (blocker) => {
      activity.blocker = blocker;

      const result = await useCase.execute({
        userId: 'alice',
        requestedBy: 'user',
        sessionCreatedAt: minutesAgo(1),
      });

      expect(result.error.code).toBe(IDENTITY_ERROR_CODES.ACCOUNT_DELETION_CONFLICT);
      expect(result.error.details).toEqual({ reason: blocker });
      expect(accounts.users.has('alice')).toBe(true);
      expect(files.scheduled).toEqual([]);
    },
  );

  it('answers not found when the user is already gone (concurrent replay)', async () => {
    accounts.users.clear();

    const result = await useCase.execute({
      userId: 'alice',
      requestedBy: 'user',
      sessionCreatedAt: minutesAgo(1),
    });

    expect(result.error.code).toBe(IDENTITY_ERROR_CODES.USER_NOT_FOUND);
    expect(files.scheduled).toEqual([]);
  });

  it('lets the operator delete whatever the session age (request checked offline)', async () => {
    const result = await useCase.execute({ userId: 'alice', requestedBy: 'operator' });

    expect(result.isOk() && result.value).toEqual({ fileCount: 2 });
    expect(accounts.users.has('alice')).toBe(false);
  });

  it('still refuses the operator while work is in progress (409)', async () => {
    activity.blocker = 'payment_pending';

    const result = await useCase.execute({ userId: 'alice', requestedBy: 'operator' });

    expect(result.error.code).toBe(IDENTITY_ERROR_CODES.ACCOUNT_DELETION_CONFLICT);
    expect(accounts.users.has('alice')).toBe(true);
  });

  it('deletes an account without any file', async () => {
    files.filesByUser.clear();

    const result = await useCase.execute({
      userId: 'alice',
      requestedBy: 'user',
      sessionCreatedAt: minutesAgo(1),
    });

    expect(result.isOk() && result.value).toEqual({ fileCount: 0 });
    expect(accounts.users.has('alice')).toBe(false);
  });
});
