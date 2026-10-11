import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';

import { CampayGateway } from './campay.gateway';

interface Received {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

const EXTERNAL_REFERENCE = '2ceefe04-1a79-4914-9dd0-c61748c2aecd';
const WEBHOOK_KEY = 'webhook-key';
const PHONE = MobileMoneyNumber.of('+237699000012').value;

const COLLECT_REQUEST = {
  externalReference: EXTERNAL_REFERENCE,
  amountXaf: 2000,
  phone: PHONE,
  description: 'Voxlivre - Pass 30 jours',
};

/** Réponse de `GET /transaction/{ref}/` telle que documentée (Postman, 2026-10-11). */
function documentedTransaction(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
    external_reference: EXTERNAL_REFERENCE,
    status: 'SUCCESSFUL',
    amount: 2000,
    currency: 'XAF',
    operator: 'MTN',
    code: 'CP201102W0002LK',
    operator_reference: '1234567890',
    description: 'Voxlivre - Pass 30 jours',
    external_user: '',
    reason: null,
    phone_number: '237699000012',
    endpoint: 'collect',
    ...overrides,
  });
}

function jwt(key: string, claims: Record<string, unknown> = {}): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ typ: 'JWT', alg: 'HS256' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`;
}

/**
 * Contre un vrai serveur HTTP local qui imite l'API Campay : vérifie ce que
 * `fetch` envoie réellement (chemin, en-têtes, corps) et la lecture des
 * réponses documentées, d'erreur comprises.
 */
describe('CampayGateway (integration, local HTTP server)', () => {
  let server: Server;
  let baseUrl: string;
  let received: Received[];
  let reply: Reply;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  beforeEach(() => {
    received = [];
    reply = { status: 200, body: '{}' };
  });

  function gateway(): CampayGateway {
    return new CampayGateway({ baseUrl, token: 'permanent-token', webhookKey: WEBHOOK_KEY });
  }

  describe('collect', () => {
    it('sends exactly what the Campay API documents', async () => {
      reply = {
        status: 200,
        body: JSON.stringify({
          reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
          ussd_code: '*126#',
          operator: 'mtn',
        }),
      };

      const result = await gateway().collect(COLLECT_REQUEST);

      expect(result.value).toStrictEqual({ reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a' });
      const [call] = received;
      expect(call).toMatchObject({ method: 'POST', url: '/api/collect/' });
      expect(call.headers.authorization).toBe('Token permanent-token');
      expect(call.headers['content-type']).toBe('application/json');
      expect(JSON.parse(call.body)).toStrictEqual({
        amount: '2000',
        currency: 'XAF',
        from: '237699000012',
        description: 'Voxlivre - Pass 30 jours',
        external_reference: EXTERNAL_REFERENCE,
      });
    });

    it.each([
      ['ER101', '{"message": "Invalid phone number", "error_code": "ER101"}'],
      ['ER102', '{"detail": "ER102: Unsupported Carrier phone number"}'],
    ])('reports %s as an invalid phone, wherever the code appears', async (_code, body) => {
      reply = { status: 400, body };
      const result = await gateway().collect(COLLECT_REQUEST);
      expect(result.error.code).toBe('INVALID_PAYMENT_PHONE');
    });

    it.each<[string, Reply]>([
      ['another client error', { status: 400, body: '{"error_code": "ER201"}' }],
      ['a server error mentioning ER101', { status: 502, body: 'ER101' }],
      ['an unauthorized token', { status: 401, body: '{"detail": "Invalid token."}' }],
      ['a success without reference', { status: 200, body: '{"ussd_code": "*126#"}' }],
      ['a success that is not JSON', { status: 200, body: '<html>proxy</html>' }],
    ])('reports %s as unavailable, without the body', async (_label, response) => {
      reply = response;
      const result = await gateway().collect(COLLECT_REQUEST);
      expect(result.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
      expect(result.error.message).not.toContain('237');
      expect(result.error.message).toMatch(/^Campay collect failed \(HTTP \d{3}/);
    });

    it('reports an unreachable provider as unavailable', async () => {
      const failing = new CampayGateway(
        { baseUrl, token: 't', webhookKey: WEBHOOK_KEY },
        { fetchFn: () => Promise.reject(new TypeError('fetch failed')) },
      );
      const result = await failing.collect(COLLECT_REQUEST);
      expect(result.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
      expect(result.error.message).toBe('Campay collect unreachable');
    });
  });

  describe('getTransaction', () => {
    it('reads the documented status response', async () => {
      reply = { status: 200, body: documentedTransaction() };

      const result = await gateway().getTransaction('bcedde9b-62a7-4421-96ac-2e6179552a1a');

      expect(received[0]).toMatchObject({
        method: 'GET',
        url: '/api/transaction/bcedde9b-62a7-4421-96ac-2e6179552a1a/',
      });
      expect(received[0].headers.authorization).toBe('Token permanent-token');
      expect(result.value).toStrictEqual({
        reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
        externalReference: EXTERNAL_REFERENCE,
        status: 'successful',
        amount: 2000,
        currency: 'XAF',
      });
    });

    it.each([
      ['PENDING', 'pending'],
      ['FAILED', 'failed'],
    ])('maps %s to %s', async (campayStatus, status) => {
      reply = { status: 200, body: documentedTransaction({ status: campayStatus }) };
      const transaction = await gateway().getTransaction('ref');
      expect(transaction.value.status).toBe(status);
    });

    it('reads a decimal amount as sent (2.0), and an empty external reference as none', async () => {
      reply = {
        status: 200,
        body: documentedTransaction({ external_reference: '' }).replace(
          '"amount":2000',
          '"amount":2.0',
        ),
      };
      const { value: transaction } = await gateway().getTransaction('ref');
      expect(transaction.amount).toBe(2);
      expect(transaction.externalReference).toBeNull();
    });

    it('escapes the reference in the path', async () => {
      reply = { status: 200, body: documentedTransaction() };
      await gateway().getTransaction('../balance');
      expect(received[0].url).toBe('/api/transaction/..%2Fbalance/');
    });

    it.each<[string, Reply]>([
      ['a not found', { status: 404, body: '{"detail": "Not found."}' }],
      ['an unknown status', { status: 200, body: documentedTransaction({ status: 'REVERSED' }) }],
      ['a missing amount', { status: 200, body: documentedTransaction({ amount: undefined }) }],
    ])('reports %s as unavailable', async (_label, response) => {
      reply = response;
      const transaction = await gateway().getTransaction('ref');
      expect(transaction.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
    });
  });

  describe('verifyNotification', () => {
    it('accepts a notification signed with the webhook key, and keeps only its references', () => {
      const result = gateway().verifyNotification({
        status: 'SUCCESSFUL',
        reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
        external_reference: EXTERNAL_REFERENCE,
        amount: '2000',
        phone_number: '237699000012',
        signature: jwt(WEBHOOK_KEY),
      });
      expect(result.value).toStrictEqual({
        reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
        externalReference: EXTERNAL_REFERENCE,
      });
    });

    it('treats a missing external reference as none', () => {
      const result = gateway().verifyNotification({
        reference: 'ref',
        external_reference: '',
        signature: jwt(WEBHOOK_KEY),
      });
      expect(result.value.externalReference).toBeNull();
    });

    it.each([
      ['signed with another key', { reference: 'ref', signature: jwt('other') }],
      ['without signature', { reference: 'ref' }],
      ['without reference', { signature: jwt(WEBHOOK_KEY) }],
      ['with an expired signature', { reference: 'ref', signature: jwt(WEBHOOK_KEY, { exp: 1 }) }],
    ])('refuses a notification %s', (_label, payload) => {
      expect(gateway().verifyNotification(payload).error.code).toBe(
        'UNAUTHORIZED_PAYMENT_NOTIFICATION',
      );
    });
  });
});
