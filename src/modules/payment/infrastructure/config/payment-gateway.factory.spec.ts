import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { CampayGateway } from '../gateway/campay.gateway';
import { DisabledGateway } from '../gateway/disabled.gateway';
import { FakeGateway } from '../gateway/fake.gateway';

import { buildPaymentGateway } from './payment-gateway.factory';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('buildPaymentGateway', () => {
  it('builds Campay with its settings', () => {
    const gateway = buildPaymentGateway(
      config({
        PAYMENT_PROVIDER: 'campay',
        CAMPAY_BASE_URL: 'https://demo.campay.net/api',
        CAMPAY_TOKEN: 'token',
        CAMPAY_WEBHOOK_KEY: 'key',
      }),
    );
    expect(gateway).toBeInstanceOf(CampayGateway);
    expect(gateway.provider).toBe('campay');
  });

  it('refuses Campay without its settings (invariant of the env schema)', () => {
    expect(() => buildPaymentGateway(config({ PAYMENT_PROVIDER: 'campay' }))).toThrow(/Invariant/);
  });

  it('builds the fake and the disabled gateways', () => {
    expect(buildPaymentGateway(config({ PAYMENT_PROVIDER: 'fake' }))).toBeInstanceOf(FakeGateway);
    expect(buildPaymentGateway(config({ PAYMENT_PROVIDER: 'disabled' }))).toBeInstanceOf(
      DisabledGateway,
    );
  });
});
