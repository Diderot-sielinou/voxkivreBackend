import { type SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';

import { type SesSender, SesEmailOtpSender } from './ses-email-otp-sender.adapter';

const DELIVERY = {
  channel: 'email' as const,
  destination: 'alice@example.cm',
  code: '481516',
  purpose: 'sign-in',
  expiresInSeconds: 300,
};

function fakeSes(fail?: Error) {
  const inputs: SendEmailCommand['input'][] = [];
  let destroyed = false;
  const client: SesSender = {
    send: ((command: SendEmailCommand) => {
      inputs.push(command.input);
      return fail === undefined ? Promise.resolve({ MessageId: 'm-1' }) : Promise.reject(fail);
    }) as SesSender['send'],
    destroy: () => {
      destroyed = true;
    },
  };
  return { client, inputs, isDestroyed: () => destroyed };
}

describe('SesEmailOtpSender', () => {
  let logs: unknown[][];

  beforeEach(() => {
    logs = [];
    const capture = (...args: unknown[]) => {
      logs.push(args);
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the code by e-mail from the verified sender, in French, without logging it', async () => {
    const { client, inputs } = fakeSes();
    await new SesEmailOtpSender(client, 'noreply@voxlivre.test').send(DELIVERY);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      FromEmailAddress: 'noreply@voxlivre.test',
      Destination: { ToAddresses: ['alice@example.cm'] },
      Content: {
        Simple: { Subject: { Data: 'Votre code de connexion Voxlivre' } },
      },
    });
    const body = inputs[0].Content?.Simple?.Body?.Text?.Data ?? '';
    expect(body).toContain('Votre code Voxlivre : 481516');
    expect(body).toContain('valable 5 minutes');
    expect(JSON.stringify(logs)).not.toContain('481516');
    expect(JSON.stringify(logs)).not.toContain('alice@example.cm');
  });

  it('never throws when SES fails (sandbox, unverified identity…), and logs neither code nor address', async () => {
    // Message réel de SES (essai du 2026-10-08) : il contient l'adresse du destinataire.
    const error = Object.assign(
      new Error(
        'Email address is not verified. The following identities failed the check in region EU-WEST-3: alice@example.cm',
      ),
      { name: 'MessageRejected', $metadata: { httpStatusCode: 400 } },
    );
    const { client } = fakeSes(error);
    await expect(
      new SesEmailOtpSender(client, 'noreply@voxlivre.test').send(DELIVERY),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(logs)).toContain('MessageRejected');
    expect(JSON.stringify(logs)).toContain('400');
    expect(JSON.stringify(logs)).not.toContain('481516');
    expect(JSON.stringify(logs)).not.toContain('alice@example.cm');
  });

  it('does not deliver SMS yet, without leaking the code; uses a generic subject for other purposes', async () => {
    const { client, inputs } = fakeSes();
    const sender = new SesEmailOtpSender(client, 'noreply@voxlivre.test');
    await sender.send({ ...DELIVERY, channel: 'sms', destination: '+237699000000' });
    expect(inputs).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain('481516');
    await sender.send({ ...DELIVERY, purpose: 'unknown', expiresInSeconds: 30 });
    expect(inputs[0].Content?.Simple?.Subject?.Data).toBe('Votre code Voxlivre');
    expect(inputs[0].Content?.Simple?.Body?.Text?.Data).toContain('valable 1 minutes');
  });

  it('closes the SDK client on shutdown', () => {
    const { client, isDestroyed } = fakeSes();
    new SesEmailOtpSender(client, 'noreply@voxlivre.test').onApplicationShutdown();
    expect(isDestroyed()).toBe(true);
  });
});
