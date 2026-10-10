import { SESv2Client } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type EmailSenderPort } from '../../domain/ports/email-sender.port';
import { type SmsSenderPort } from '../../domain/ports/sms-sender.port';
import { SesEmailAdapter } from '../email/ses-email.adapter';
import { UnconfiguredEmailSender } from '../email/unconfigured-email.adapter';
import { OrangeSmsAdapter } from '../sms/orange-sms.adapter';
import { UnconfiguredSmsSender } from '../sms/unconfigured-sms.adapter';

const logger = new Logger('NotificationProviders');

/** Les alertes n'ont de sens que si les codes doivent vraiment partir. */
function deliveryExpected(config: ConfigService<Env, true>): boolean {
  return config.get('OTP_DELIVERY_MODE', { infer: true }) === 'notification';
}

/**
 * Orange si ses identifiants sont posés, sinon un adapter qui échoue (`failed`)
 * — l'API démarre quand même (ADR-0017), avec une alerte au boot.
 */
export function buildSmsSender(config: ConfigService<Env, true>): SmsSenderPort {
  const clientId = config.get('ORANGE_SMS_CLIENT_ID', { infer: true });
  const clientSecret = config.get('ORANGE_SMS_CLIENT_SECRET', { infer: true });
  if (clientId === undefined || clientSecret === undefined) {
    if (deliveryExpected(config)) {
      logger.warn('ORANGE_SMS_* not set: phone sign-in codes will NOT be delivered');
    }
    return new UnconfiguredSmsSender();
  }
  return new OrangeSmsAdapter(
    { clientId, clientSecret },
    { senderName: config.get('ORANGE_SMS_SENDER_NAME', { infer: true }) },
  );
}

/** SES si l'expéditeur et la région sont posés (ADR-0014), sinon un adapter qui échoue. */
export function buildEmailSender(config: ConfigService<Env, true>): EmailSenderPort {
  const from = config.get('OTP_EMAIL_FROM', { infer: true });
  const region = config.get('AWS_REGION', { infer: true });
  if (from === undefined || region === undefined) {
    if (deliveryExpected(config)) {
      logger.warn('OTP_EMAIL_FROM / AWS_REGION not set: e-mail codes will NOT be delivered');
    }
    return new UnconfiguredEmailSender();
  }
  return new SesEmailAdapter(new SESv2Client({ region, maxAttempts: 2 }), from);
}
