import { type SendEmailCommand } from '@aws-sdk/client-sesv2';

import { SesEmailAdapter, type SesSender } from './ses-email.adapter';

describe('SesEmailAdapter', () => {
  it('sends a plain-text UTF-8 e-mail from the verified sender shown as Voxlivre, and closes the client', async () => {
    const inputs: SendEmailCommand['input'][] = [];
    let destroyed = false;
    const client: SesSender = {
      send: ((command: SendEmailCommand) => {
        inputs.push(command.input);
        return Promise.resolve({});
      }) as SesSender['send'],
      destroy: () => {
        destroyed = true;
      },
    };
    const adapter = new SesEmailAdapter(client, 'noreply@voxlivre.test');

    await adapter.send({ to: 'ada@x.cm', subject: 'Sujet', text: 'Corps' });
    adapter.onApplicationShutdown();

    // eslint-disable-next-line unicorn/text-encoding-identifier-case -- valeur imposée par l'API SES
    const charset = 'UTF-8';
    expect(inputs[0]).toMatchObject({
      FromEmailAddress: 'Voxlivre <noreply@voxlivre.test>',
      Destination: { ToAddresses: ['ada@x.cm'] },
      Content: {
        Simple: {
          Subject: { Data: 'Sujet', Charset: charset },
          Body: { Text: { Data: 'Corps', Charset: charset } },
        },
      },
    });
    expect(destroyed).toBe(true);
  });
});
