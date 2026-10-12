import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { ACCOUNT_ACTIVITY } from '@/modules/identity/domain/ports/account-activity.port';
import { ACCOUNT_FILES } from '@/modules/identity/domain/ports/account-files.port';
import { USER_ACCOUNTS } from '@/modules/identity/domain/ports/user-accounts.port';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { CLOCK, UnauthorizedError } from '@/shared/kernel';
import { UNIT_OF_WORK } from '@/shared/persistence/unit-of-work.port';

import { bootstrapTestApp } from '../support';
import { FixedClock, ImmediateUnitOfWork } from '../support/fakes';
import {
  InMemoryUserAccounts,
  StubAccountActivity,
  StubAccountFiles,
} from '../support/fakes/account-deletion-stubs';

const NOW = new Date('2026-10-12T09:00:00Z');
const USER_HEADER = 'x-test-user';
const SESSION_AGE_HEADER = 'x-test-session-age-minutes';

/**
 * E2E suppression du compte : AppModule complet, ports de la suppression
 * remplacés par des fakes. Le guard de test lit l'identité et l'âge de la
 * session dans des en-têtes ; comme le vrai (sessions supprimées en cascade,
 * prouvé dans `better-auth.int.spec.ts`), il refuse un compte disparu.
 */
describe('account deletion (e2e)', () => {
  let app: INestApplication;
  let accounts: InMemoryUserAccounts;
  let activity: StubAccountActivity;
  let files: StubAccountFiles;

  const headerSessionGuard: CanActivate = {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
      const id = req.headers[USER_HEADER];
      if (typeof id !== 'string' || !accounts.users.has(id)) {
        throw new UnauthorizedError('Session required');
      }
      const ageMinutes = Number(req.headers[SESSION_AGE_HEADER] ?? '1');
      req.authUser = {
        id,
        email: `${id}@test.cm`,
        role: 'user' as never,
        sessionCreatedAt: new Date(NOW.getTime() - ageMinutes * 60_000),
      };
      return true;
    },
  };

  beforeEach(async () => {
    accounts = new InMemoryUserAccounts();
    accounts.users.add('alice');
    activity = new StubAccountActivity();
    files = new StubAccountFiles();
    files.filesByUser.set('alice', ['documents/alice/d1/source.pdf']);
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(USER_ACCOUNTS)
      .useValue(accounts)
      .overrideProvider(ACCOUNT_ACTIVITY)
      .useValue(activity)
      .overrideProvider(ACCOUNT_FILES)
      .useValue(files)
      .overrideProvider(UNIT_OF_WORK)
      .useValue(new ImmediateUnitOfWork())
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(NOW))
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('DELETE /v1/me → 204, files queued; a replay → 401', async () => {
    const res = await http().delete('/v1/me').set(USER_HEADER, 'alice').expect(204);

    expect(res.text).toBe('');
    expect(accounts.users.has('alice')).toBe(false);
    expect(files.scheduled.map((s) => s.key)).toEqual(['documents/alice/d1/source.pdf']);

    const replay = await http().delete('/v1/me').set(USER_HEADER, 'alice').expect(401);
    expect(replay.body.code).toBe('UNAUTHORIZED');
  });

  it('403 RECENT_LOGIN_REQUIRED when the session is older than 10 minutes', async () => {
    const res = await http()
      .delete('/v1/me')
      .set(USER_HEADER, 'alice')
      .set(SESSION_AGE_HEADER, '11')
      .expect(403)
      .expect('content-type', /application\/problem\+json/);

    expect(res.body).toMatchObject({
      status: 403,
      code: 'RECENT_LOGIN_REQUIRED',
      details: { maxAgeSeconds: 600 },
    });
    expect(accounts.users.has('alice')).toBe(true);
  });

  it.each(['conversion_in_progress', 'payment_pending'] as const)(
    '409 ACCOUNT_DELETION_CONFLICT while %s',
    async (reason) => {
      activity.blocker = reason;

      const res = await http().delete('/v1/me').set(USER_HEADER, 'alice').expect(409);

      expect(res.body).toMatchObject({ code: 'ACCOUNT_DELETION_CONFLICT', details: { reason } });
      expect(accounts.users.has('alice')).toBe(true);
      expect(files.scheduled).toEqual([]);
    },
  );

  it('401 without a session', async () => {
    const res = await http().delete('/v1/me').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
