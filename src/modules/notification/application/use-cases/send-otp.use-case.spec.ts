import { Logger } from '@nestjs/common';

import { FixedClock } from '../../../../../test/support/fakes';
import { type OtpChannel, type OtpDispatch } from '../../domain/otp-dispatch';
import { type EmailMessage, type EmailSenderPort } from '../../domain/ports/email-sender.port';
import { type OtpDispatchLogPort } from '../../domain/ports/otp-dispatch-log.port';
import { type SmsSenderPort } from '../../domain/ports/sms-sender.port';

import { SendOtpUseCase } from './send-otp.use-case';

const NOW = new Date('2026-10-10T12:00:00Z');

class InMemoryDispatchLog implements OtpDispatchLogPort {
  readonly rows: { channel: OtpChannel; key: string; at: Date }[] = [];

  record(channel: OtpChannel, key: string, at: Date): Promise<void> {
    this.rows.push({ channel, key, at });
    return Promise.resolve();
  }

  countForDestinationSince(key: string, since: Date): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => r.key === key && r.at >= since).length);
  }

  countForChannelSince(channel: OtpChannel, since: Date): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => r.channel === channel && r.at >= since).length);
  }

  purgeBefore(): Promise<number> {
    return Promise.resolve(0);
  }
}

class RecordingSms implements SmsSenderPort {
  readonly sent: { to: string; text: string }[] = [];
  failure: Error | null = null;

  send(to: string, text: string): Promise<void> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.sent.push({ to, text });
    return Promise.resolve();
  }
}

class RecordingEmail implements EmailSenderPort {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const sms = (destination = '+237699000012', code = '123456'): OtpDispatch => ({
  channel: 'sms',
  destination,
  code,
  purpose: 'sign-in',
  expiresInSeconds: 300,
});

describe('SendOtpUseCase', () => {
  let log: InMemoryDispatchLog;
  let smsSender: RecordingSms;
  let email: RecordingEmail;
  let logs: { level: string; args: unknown[] }[];
  let useCase: SendOtpUseCase;

  beforeEach(() => {
    log = new InMemoryDispatchLog();
    smsSender = new RecordingSms();
    email = new RecordingEmail();
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push({ level, args });
      });
    }
    useCase = new SendOtpUseCase(
      smsSender,
      email,
      log,
      { keyOf: (d) => `key(${d})` },
      { smsDailyLimit: 5 },
      new FixedClock(NOW),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the SMS, records it hashed, and never logs the code nor the number', async () => {
    expect(await useCase.execute(sms())).toBe('sent');
    expect(smsSender.sent).toEqual([
      { to: '+237699000012', text: expect.stringContaining('123456') as string },
    ]);
    expect(log.rows).toEqual([{ channel: 'sms', key: 'key(+237699000012)', at: NOW }]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain('+237699000012');
    expect(logged).toContain('+2376••••••12');
  });

  it('routes e-mails to the e-mail sender', async () => {
    expect(await useCase.execute({ ...sms('ada@x.cm'), channel: 'email' })).toBe('sent');
    expect(email.sent[0]).toMatchObject({
      to: 'ada@x.cm',
      subject: 'Votre code de connexion Voxlivre',
    });
  });

  it('refuses a 4th code to the same destination within the hour', async () => {
    for (let i = 0; i < 3; i += 1) expect(await useCase.execute(sms())).toBe('sent');
    expect(await useCase.execute(sms())).toBe('rate_limited');
    expect(smsSender.sent).toHaveLength(3);
    // Une autre destination n'est pas concernée.
    expect(await useCase.execute(sms('+237677000000'))).toBe('sent');
  });

  it('stops all SMS at the daily cap, alerting at 80 %', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(await useCase.execute(sms(`+23769900000${String(i)}`))).toBe('sent');
    }
    expect(logs.some((l) => l.args.includes('SMS daily limit nearly reached'))).toBe(true);
    expect(await useCase.execute(sms('+237699000099'))).toBe('rate_limited');
    expect(logs.at(-1)?.level).toBe('error');
    // Les e-mails ne sont pas plafonnés par jour.
    expect(await useCase.execute({ ...sms('ada@x.cm'), channel: 'email' })).toBe('sent');
  });

  it('reports a provider failure as failed, with the error name, step and status only', async () => {
    smsSender.failure = Object.assign(new Error('blocked +237699000012'), {
      name: 'OrangeSmsError',
      step: 'send',
      status: 403,
    });
    expect(await useCase.execute(sms())).toBe('failed');
    const failure = logs.find((l) => l.args.includes('otp.delivery_failed'));
    expect(failure?.args[0]).toMatchObject({
      errorName: 'OrangeSmsError',
      step: 'send',
      httpStatus: 403,
    });
    expect(JSON.stringify(logs)).not.toContain('+237699000012');
  });
});
