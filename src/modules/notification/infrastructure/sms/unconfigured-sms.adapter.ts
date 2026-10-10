import { type SmsSenderPort } from '../../domain/ports/sms-sender.port';

/** Sans identifiants Orange : chaque envoi échoue (`failed`), une alerte est loggée au boot. */
export class UnconfiguredSmsSender implements SmsSenderPort {
  send(): Promise<void> {
    const error = new Error('SMS provider is not configured');
    error.name = 'SmsNotConfiguredError';
    return Promise.reject(error);
  }
}
