import { type EmailSenderPort } from '../../domain/ports/email-sender.port';

/** Sans expéditeur SES : chaque envoi échoue (`failed`), une alerte est loggée au boot. */
export class UnconfiguredEmailSender implements EmailSenderPort {
  send(): Promise<void> {
    const error = new Error('Email sender is not configured');
    error.name = 'EmailNotConfiguredError';
    return Promise.reject(error);
  }
}
