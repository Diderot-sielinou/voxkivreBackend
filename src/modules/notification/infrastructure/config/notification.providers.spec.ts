import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { SesEmailAdapter } from '../email/ses-email.adapter';
import { UnconfiguredEmailSender } from '../email/unconfigured-email.adapter';
import { OrangeSmsAdapter } from '../sms/orange-sms.adapter';
import { UnconfiguredSmsSender } from '../sms/unconfigured-sms.adapter';

import { buildEmailSender, buildSmsSender } from './notification.providers';

function configOf(values: Partial<Record<keyof Env, unknown>>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('notification providers', () => {
  let warnings: unknown[][];

  beforeEach(() => {
    warnings = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Orange and SES when configured', () => {
    expect(
      buildSmsSender(configOf({ ORANGE_SMS_CLIENT_ID: 'id', ORANGE_SMS_CLIENT_SECRET: 'secret' })),
    ).toBeInstanceOf(OrangeSmsAdapter);
    expect(
      buildEmailSender(configOf({ OTP_EMAIL_FROM: 'noreply@x.cm', AWS_REGION: 'eu-west-3' })),
    ).toBeInstanceOf(SesEmailAdapter);
    expect(warnings).toEqual([]);
  });

  it('falls back to failing senders, warning only when codes must really be delivered', async () => {
    expect(buildSmsSender(configOf({ OTP_DELIVERY_MODE: 'log' }))).toBeInstanceOf(
      UnconfiguredSmsSender,
    );
    expect(warnings).toEqual([]);

    const sms = buildSmsSender(configOf({ OTP_DELIVERY_MODE: 'notification' }));
    const email = buildEmailSender(configOf({ OTP_DELIVERY_MODE: 'notification' }));
    expect(email).toBeInstanceOf(UnconfiguredEmailSender);
    expect(warnings).toHaveLength(2);
    await expect(sms.send('+237699000012', 'x')).rejects.toMatchObject({
      name: 'SmsNotConfiguredError',
    });
    await expect(email.send({ to: 'a@x.cm', subject: 's', text: 't' })).rejects.toMatchObject({
      name: 'EmailNotConfiguredError',
    });
  });
});
