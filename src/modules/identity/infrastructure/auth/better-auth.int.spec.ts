import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { type OtpDelivery, type OtpSenderPort } from '../../domain/ports/otp-sender.port';
import { UserId } from '../../domain/value-objects/user-id.vo';
import { DrizzleUserQuery } from '../persistence/user.drizzle-query';

import { buildBetterAuth, type BetterAuthInstance } from './better-auth.config';

const BASE_URL = 'http://localhost:8080';
// IPs de test (RFC 1918) — servent uniquement de clé de rate-limit.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- valeur de test
const CLIENT_IP = '10.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- valeur de test
const SPAMMER_IP = '10.0.0.99';
const AUTH = `${BASE_URL}/api/auth`;

/** Capture les codes au lieu de les envoyer. */
class CapturingOtpSender implements OtpSenderPort {
  readonly deliveries: OtpDelivery[] = [];

  send(delivery: OtpDelivery): Promise<void> {
    this.deliveries.push(delivery);
    return Promise.resolve();
  }

  lastCodeFor(destination: string): string {
    const found = this.deliveries.toReversed().find((d) => d.destination === destination);
    if (found === undefined) throw new Error(`no OTP delivered to ${destination}`);
    return found.code;
  }
}

/**
 * Appelle better-auth via son handler fetch-style (`auth.handler(Request)`) —
 * exactement ce que `toNodeHandler` fait derrière Express, sans monter Nest.
 * `x-forwarded-for` distingue les "clients" pour le rate-limit par IP.
 */
async function post(
  auth: BetterAuthInstance,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function get(auth: BetterAuthInstance, path: string, headers: Record<string, string>) {
  return auth.handler(new Request(`${AUTH}${path}`, { method: 'GET', headers }));
}

describe('better-auth OTP (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let sender: CapturingOtpSender;
  let auth: BetterAuthInstance;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    sender = new CapturingOtpSender();
    auth = buildBetterAuth(
      {
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET: 's'.repeat(40),
        BETTER_AUTH_URL: BASE_URL,
        BETTER_AUTH_TRUSTED_ORIGINS: [],
        OTP_LENGTH: 6,
        OTP_EXPIRES_IN_SECONDS: 300,
        OTP_ALLOWED_ATTEMPTS: 3,
        AUTH_RATE_LIMIT_STORAGE: 'database',
        SESSION_EXPIRES_IN_SECONDS: 3600,
        SESSION_UPDATE_AGE_SECONDS: 60,
      },
      pg.db,
      sender,
    );
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  it('email: sends a 6-digit OTP, signs in, and the bearer token opens a session', async () => {
    const email = 'ada@univ-yaounde.cm';
    const sent = await post(auth, '/email-otp/send-verification-otp', { email, type: 'sign-in' });
    expect(sent.status).toBe(200);
    const code = sender.lastCodeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(sender.deliveries.at(-1)).toMatchObject({ channel: 'email', purpose: 'sign-in' });

    const signedIn = await post(auth, '/sign-in/email-otp', { email, otp: code });
    expect(signedIn.status).toBe(200);
    const token = signedIn.headers.get('set-auth-token');
    expect(token).toMatch(/^[^.]+\.[^.]+$/); // <token>.<signature> (requireSignature)

    const session = await get(auth, '/get-session', { authorization: `Bearer ${String(token)}` });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user: { email: string; role?: string } };
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe('user');
  });

  it('email: locks the code after 3 wrong attempts', async () => {
    const email = 'bob@x.cm';
    await post(auth, '/email-otp/send-verification-otp', { email, type: 'sign-in' });
    for (let i = 0; i < 3; i += 1) {
      const r = await post(auth, '/sign-in/email-otp', { email, otp: '000000' });
      expect(r.status).toBe(400);
    }
    const locked = await post(auth, '/sign-in/email-otp', {
      email,
      otp: sender.lastCodeFor(email),
    });
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { code: string }).code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('phone: creates the account on first verification with a technical email', async () => {
    const phone = '+237699000000';
    const sent = await post(auth, '/phone-number/send-otp', { phoneNumber: phone });
    expect(sent.status).toBe(200);
    expect(sender.deliveries.at(-1)).toMatchObject({ channel: 'sms', destination: phone });

    const verified = await post(auth, '/phone-number/verify', {
      phoneNumber: phone,
      code: sender.lastCodeFor(phone),
    });
    expect(verified.status).toBe(200);
    const token = verified.headers.get('set-auth-token');
    expect(token).not.toBeNull();

    const session = await get(auth, '/get-session', { authorization: `Bearer ${String(token)}` });
    const body = (await session.json()) as { user: { id: string; email: string } };
    expect(body.user.email).toBe('237699000000@phone.voxlivre.local');

    // La projection domain relit la même ligne et masque l'email technique.
    const user = await new DrizzleUserQuery(pg.db).findById(UserId.of(body.user.id));
    expect(user).toMatchObject({
      phoneNumber: phone,
      phoneNumberVerified: true,
      role: 'user',
      name: null,
    });
  });

  it('phone: rejects a non-E.164 number', async () => {
    const r = await post(auth, '/phone-number/send-otp', { phoneNumber: '699000000' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe('INVALID_PHONE_NUMBER');
    expect(sender.deliveries.some((d) => d.destination === '699000000')).toBe(false);
  });

  it('rate-limits OTP sending per IP (5 per 10 min) with the counter stored in Postgres', async () => {
    const ip = { 'x-forwarded-for': SPAMMER_IP };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await post(
        auth,
        '/email-otp/send-verification-otp',
        { email: `s${String(i)}@x.cm`, type: 'sign-in' },
        ip,
      );
      statuses.push(r.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const keyPattern = `${SPAMMER_IP}%`;
    const rows = await pg.sql`SELECT count FROM rate_limit WHERE key LIKE ${keyPattern}`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sign-out invalidates the bearer token', async () => {
    const email = 'carol@x.cm';
    await post(auth, '/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const signedIn = await post(auth, '/sign-in/email-otp', {
      email,
      otp: sender.lastCodeFor(email),
    });
    const token = String(signedIn.headers.get('set-auth-token'));
    const bearer = { authorization: `Bearer ${token}` };

    const signedOut = await post(auth, '/sign-out', {}, bearer);
    expect(signedOut.status).toBe(200);
    const after = await get(auth, '/get-session', bearer);
    expect(await after.text()).toBe('null');
  });
});
