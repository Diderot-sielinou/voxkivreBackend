import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { FakeTtsAdapter } from './fake-tts.adapter';
import { PollyTtsAdapter } from './polly-tts.adapter';
import { buildTtsEngine } from './tts-engine.factory';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('buildTtsEngine', () => {
  it('uses Polly when TTS_PROVIDER=polly (credentials from the SDK default chain)', async () => {
    const engine = buildTtsEngine(config({ TTS_PROVIDER: 'polly', AWS_REGION: 'eu-west-3' }));
    expect(engine).toBeInstanceOf(PollyTtsAdapter);
    // HTTP/1.1 : le HTTP/2 par défaut du client Polly refuse nos requêtes simultanées.
    const client = (engine as unknown as { client: { config: { requestHandler: unknown } } })
      .client;
    expect((client.config.requestHandler as object).constructor.name).toBe('NodeHttpHandler');
    (engine as PollyTtsAdapter).onApplicationShutdown();
    await Promise.resolve();
  });

  it('falls back to the fake engine, loudly, when TTS_PROVIDER=fake', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    expect(buildTtsEngine(config({ TTS_PROVIDER: 'fake' }))).toBeInstanceOf(FakeTtsAdapter);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
