import { FixedClock, ImmediateUnitOfWork } from '../../../../../test/support/fakes';
import {
  InMemoryUserAccounts,
  StubAccountActivity,
  StubAccountFiles,
} from '../../../../../test/support/fakes/account-deletion-stubs';
import { DeleteAccountUseCase } from '../../application/use-cases/delete-account.use-case';

import { EXIT, parseAccountDeleteArgs, runAccountDelete } from './account-delete.command';

describe('parseAccountDeleteArgs', () => {
  it.each([
    [['alice@x.cm'], { contact: 'alice@x.cm', confirmed: false }],
    [['--yes', 'alice@x.cm'], { contact: 'alice@x.cm', confirmed: true }],
    [['+237690000001', '--yes'], { contact: '+237690000001', confirmed: true }],
  ])('accepts %j', (argv, expected) => {
    expect(parseAccountDeleteArgs(argv)).toEqual(expected);
  });

  it.each([[[]], [['--yes']], [['a@x.cm', 'b@x.cm']], [['alice']], [['690000001']], [['--force']]])(
    'rejects %j',
    (argv) => {
      expect(parseAccountDeleteArgs(argv)).toBeNull();
    },
  );
});

describe('runAccountDelete', () => {
  let accounts: InMemoryUserAccounts;
  let activity: StubAccountActivity;
  let lines: Record<string, unknown>[];
  let deps: Parameters<typeof runAccountDelete>[1];

  beforeEach(() => {
    accounts = new InMemoryUserAccounts();
    accounts.users.add('u1');
    accounts.contacts.set('alice@x.cm', 'u1');
    activity = new StubAccountActivity();
    const files = new StubAccountFiles();
    files.filesByUser.set('u1', ['documents/u1/d1/source.pdf']);
    lines = [];
    deps = {
      accounts,
      activity,
      deleteAccount: new DeleteAccountUseCase(
        accounts,
        activity,
        files,
        new ImmediateUnitOfWork(),
        new FixedClock(new Date('2026-10-12T09:00:00Z')),
      ),
      print: (line) => lines.push({ ...line }),
    };
  });

  it('only reports without --yes, and deletes nothing', async () => {
    activity.blocker = 'payment_pending';

    const code = await runAccountDelete({ contact: 'alice@x.cm', confirmed: false }, deps);

    expect(code).toBe(EXIT.OK);
    expect(lines).toEqual([
      expect.objectContaining({ outcome: 'dry_run', userId: 'u1', blocker: 'payment_pending' }),
    ]);
    expect(accounts.users.has('u1')).toBe(true);
  });

  it('deletes with --yes, without asking for a recent sign-in', async () => {
    const code = await runAccountDelete({ contact: 'alice@x.cm', confirmed: true }, deps);

    expect(code).toBe(EXIT.OK);
    expect(lines).toEqual([{ outcome: 'deleted', userId: 'u1', fileCount: 1 }]);
    expect(accounts.users.has('u1')).toBe(false);
  });

  it('exits 3 with the code when work is in progress', async () => {
    activity.blocker = 'conversion_in_progress';

    const code = await runAccountDelete({ contact: 'alice@x.cm', confirmed: true }, deps);

    expect(code).toBe(EXIT.REFUSED);
    expect(lines).toEqual([
      {
        outcome: 'refused',
        userId: 'u1',
        code: 'ACCOUNT_DELETION_CONFLICT',
        details: { reason: 'conversion_in_progress' },
      },
    ]);
  });

  it('exits 3 when no account matches, without echoing the contact', async () => {
    const code = await runAccountDelete({ contact: 'nobody@x.cm', confirmed: true }, deps);

    expect(code).toBe(EXIT.REFUSED);
    expect(lines).toEqual([{ outcome: 'not_found' }]);
  });
});
