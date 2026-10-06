import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { FakeTtsAdapter } from './fake-tts.adapter';
import { GoogleTtsAdapter } from './google-tts.adapter';
import { buildTtsEngine } from './tts-engine.factory';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('buildTtsEngine', () => {
  it('uses Google when the service account is configured', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 1024 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const engine = buildTtsEngine(
      config({
        GOOGLE_TTS_CLIENT_EMAIL: 'tts@x.iam.gserviceaccount.com',
        GOOGLE_TTS_PRIVATE_KEY: pem,
      }),
    );
    expect(engine).toBeInstanceOf(GoogleTtsAdapter);
  });

  it('falls back to the fake engine, loudly, without credentials', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    expect(buildTtsEngine(config({}))).toBeInstanceOf(FakeTtsAdapter);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
