import { Injectable, Logger } from '@nestjs/common';

import { type OtpDelivery, type OtpSenderPort } from '../../domain/ports/otp-sender.port';

/**
 * Adapter de DEV : écrit le code dans les logs au lieu de l'envoyer.
 * Le champ s'appelle volontairement `otpCode` (et non `otp`/`code`) pour
 * échapper à la redaction Pino — c'est le SEUL endroit où un code est loggé,
 * et le schéma d'env refuse ce mode en production sans override explicite.
 */
@Injectable()
export class LoggingOtpSenderAdapter implements OtpSenderPort {
  private readonly logger = new Logger(LoggingOtpSenderAdapter.name);

  send(delivery: OtpDelivery): Promise<void> {
    this.logger.warn(
      {
        channel: delivery.channel,
        destination: delivery.destination,
        purpose: delivery.purpose,
        expiresInSeconds: delivery.expiresInSeconds,
        otpCode: delivery.code,
      },
      `[DEV] OTP for ${delivery.destination}: ${delivery.code}`,
    );
    return Promise.resolve();
  }
}
