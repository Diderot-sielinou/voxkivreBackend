import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import { CampayGateway } from '../gateway/campay.gateway';
import { DisabledGateway } from '../gateway/disabled.gateway';
import { FakeGateway } from '../gateway/fake.gateway';

const logger = new Logger('PaymentGateway');

/**
 * Prestataire choisi par `PAYMENT_PROVIDER` (ADR-0021 §1). La cohérence est
 * déjà garantie par le schéma d'env : `campay` a ses trois variables, `fake`
 * est refusé en production.
 */
export function buildPaymentGateway(config: ConfigService<Env, true>): PaymentGatewayPort {
  const provider = config.get('PAYMENT_PROVIDER', { infer: true });
  switch (provider) {
    case 'campay': {
      const baseUrl = config.get('CAMPAY_BASE_URL', { infer: true });
      const token = config.get('CAMPAY_TOKEN', { infer: true });
      const webhookKey = config.get('CAMPAY_WEBHOOK_KEY', { infer: true });
      if (baseUrl === undefined || token === undefined || webhookKey === undefined) {
        throw new Error('Invariant: CAMPAY_* checked by the env schema');
      }
      return new CampayGateway({ baseUrl, token, webhookKey });
    }
    case 'fake': {
      logger.warn('PAYMENT_PROVIDER=fake: every payment succeeds without any money moving');
      return new FakeGateway();
    }
    case 'disabled': {
      return new DisabledGateway();
    }
  }
}
