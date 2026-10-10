import { OrangeSmsAdapter, OrangeSmsError } from './orange-sms.adapter';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** Faux `fetch` : répond selon l'URL, enregistre les appels. */
function fakeFetch(responses: { token?: Response[]; send?: Response[] }) {
  const calls: Call[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const queue = url.endsWith('/oauth/v3/token') ? responses.token : responses.send;
    const next = queue?.shift();
    return next === undefined
      ? Promise.reject(new Error('unexpected call'))
      : Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const token = (value: string, expiresIn = '3600') =>
  Response.json(
    { token_type: 'Bearer', access_token: value, expires_in: expiresIn },
    {
      status: 200,
    },
  );
const created = () => new Response('{}', { status: 201 });

describe('OrangeSmsAdapter', () => {
  const credentials = { clientId: 'id', clientSecret: 'secret' };

  it('gets a token with Basic auth, then posts the SMS in the Orange format', async () => {
    const { fn, calls } = fakeFetch({ token: [token('t1')], send: [created()] });
    const adapter = new OrangeSmsAdapter(credentials, { senderName: 'VOXLIVRE', fetchFn: fn });

    await adapter.send('+237699000012', 'Votre code 123456');

    expect(calls[0]?.url).toBe('https://api.orange.com/oauth/v3/token');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('id:secret').toString('base64')}`,
    });
    expect(calls[0]?.init.body).toBe('grant_type=client_credentials');
    expect(calls[1]?.url).toBe(
      'https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2370000/requests',
    );
    expect(calls[1]?.init.headers).toMatchObject({ Authorization: 'Bearer t1' });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({
      outboundSMSMessageRequest: {
        address: 'tel:+237699000012',
        senderAddress: 'tel:+2370000',
        senderName: 'VOXLIVRE',
        outboundSMSTextMessage: { message: 'Votre code 123456' },
      },
    });
  });

  it('reuses the token until one minute before it expires', async () => {
    let now = 0;
    const { fn, calls } = fakeFetch({
      token: [token('t1'), token('t2')],
      send: [created(), created(), created()],
    });
    const adapter = new OrangeSmsAdapter(credentials, { fetchFn: fn, now: () => now });

    await adapter.send('+237699000012', 'a');
    now = 3_539_000; // 59 min plus tard : encore valable
    await adapter.send('+237699000012', 'b');
    now = 3_541_000; // dans la dernière minute : renouvelé
    await adapter.send('+237699000012', 'c');

    const tokens = calls.filter((c) => c.url.endsWith('/oauth/v3/token'));
    expect(tokens).toHaveLength(2);
    const send = JSON.parse(calls[1]?.init.body as string) as { outboundSMSMessageRequest: object };
    expect(send.outboundSMSMessageRequest).not.toHaveProperty('senderName');
  });

  it('renews the token once when Orange answers 401', async () => {
    const { fn, calls } = fakeFetch({
      token: [token('old'), token('new')],
      send: [new Response('{"code":42}', { status: 401 }), created()],
    });
    await new OrangeSmsAdapter(credentials, { fetchFn: fn }).send('+237699000012', 'x');
    expect(calls.map((c) => c.init.headers).at(-1)).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('fails with the step and HTTP status only (no provider body, which may cite the number)', async () => {
    const { fn } = fakeFetch({
      token: [token('t')],
      send: [new Response('{"message":"+237699000012 blocked"}', { status: 403 })],
    });
    const error = await new OrangeSmsAdapter(credentials, { fetchFn: fn })
      .send('+237699000012', 'x')
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(OrangeSmsError);
    expect(error).toMatchObject({ name: 'OrangeSmsError', step: 'send', status: 403 });
    expect((error as Error).message).not.toContain('237699');

    const badToken = fakeFetch({ token: [new Response('nope', { status: 401 })] });
    await expect(
      new OrangeSmsAdapter(credentials, { fetchFn: badToken.fn }).send('+237699000012', 'x'),
    ).rejects.toMatchObject({ step: 'token', status: 401 });

    const malformed = fakeFetch({ token: [new Response('{"unexpected":true}', { status: 200 })] });
    await expect(
      new OrangeSmsAdapter(credentials, { fetchFn: malformed.fn }).send('+237699000012', 'x'),
    ).rejects.toMatchObject({ step: 'token' });
  });
});
