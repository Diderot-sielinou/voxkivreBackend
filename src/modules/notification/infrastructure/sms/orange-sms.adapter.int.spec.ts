import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { OrangeSmsAdapter } from './orange-sms.adapter';

interface Received {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

/**
 * Contre un vrai serveur HTTP local qui imite l'API Orange : vérifie ce que
 * `fetch` envoie réellement sur le réseau (chemin encodé, en-têtes, corps).
 */
describe('OrangeSmsAdapter (integration, local HTTP server)', () => {
  let server: Server;
  let baseUrl: string;
  const received: Received[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url === '/oauth/v3/token') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ token_type: 'Bearer', access_token: 'tok', expires_in: '3600' }),
          );
          return;
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{"outboundSMSMessageRequest":{}}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  it('sends exactly what the Orange API documents', async () => {
    await new OrangeSmsAdapter({ clientId: 'id', clientSecret: 'secret' }, { baseUrl }).send(
      '+237699000012',
      'Voxlivre : votre code est 123456.',
    );

    const [tokenCall, sendCall] = received;
    expect(tokenCall).toMatchObject({
      method: 'POST',
      url: '/oauth/v3/token',
      body: 'grant_type=client_credentials',
    });
    expect(tokenCall.headers.authorization).toBe(
      `Basic ${Buffer.from('id:secret').toString('base64')}`,
    );
    expect(tokenCall.headers['content-type']).toBe('application/x-www-form-urlencoded');

    expect(sendCall).toMatchObject({
      method: 'POST',
      url: '/smsmessaging/v1/outbound/tel%3A%2B2370000/requests',
    });
    expect(sendCall.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(sendCall.body)).toEqual({
      outboundSMSMessageRequest: {
        address: 'tel:+237699000012',
        senderAddress: 'tel:+2370000',
        outboundSMSTextMessage: { message: 'Voxlivre : votre code est 123456.' },
      },
    });
  });
});
