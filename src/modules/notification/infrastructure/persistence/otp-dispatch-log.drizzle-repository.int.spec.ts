import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';

import { DrizzleOtpDispatchLog } from './otp-dispatch-log.drizzle-repository';
import { otpDispatches } from './schema/notification.schema';

const AT = new Date('2026-10-10T12:00:00Z');
const minutesAgo = (n: number) => new Date(AT.getTime() - n * 60_000);
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

/** Contre un vrai Postgres migré (0008) : comptages par fenêtre et purge. */
describe('DrizzleOtpDispatchLog (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let log: DrizzleOtpDispatchLog;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    log = new DrizzleOtpDispatchLog(pg.db);
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.db.delete(otpDispatches);
  });

  it('counts per destination and per channel within a window', async () => {
    await log.record('sms', KEY_A, minutesAgo(90));
    await log.record('sms', KEY_A, minutesAgo(30));
    await log.record('sms', KEY_A, minutesAgo(5));
    await log.record('email', KEY_B, minutesAgo(5));

    expect(await log.countForDestinationSince(KEY_A, minutesAgo(60))).toBe(2);
    expect(await log.countForDestinationSince(KEY_B, minutesAgo(60))).toBe(1);
    expect(await log.countForChannelSince('sms', minutesAgo(120))).toBe(3);
    expect(await log.countForChannelSince('email', minutesAgo(120))).toBe(1);
  });

  it('purges records older than the cutoff', async () => {
    await log.record('sms', KEY_A, minutesAgo(3 * 24 * 60));
    await log.record('sms', KEY_A, minutesAgo(5));
    expect(await log.purgeBefore(minutesAgo(2 * 24 * 60))).toBe(1);
    expect(await log.countForChannelSince('sms', minutesAgo(10 * 24 * 60))).toBe(1);
  });

  it('refuses an unknown channel (CHECK constraint)', async () => {
    await expect(log.record('fax' as never, KEY_A, AT)).rejects.toThrow();
  });
});
