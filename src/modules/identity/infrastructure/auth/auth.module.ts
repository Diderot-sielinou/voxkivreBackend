import { SESv2Client } from '@aws-sdk/client-sesv2';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';
import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { OTP_SENDER, type OtpSenderPort } from '../../domain/ports/otp-sender.port';
import { LoggingOtpSenderAdapter } from '../otp/logging-otp-sender.adapter';
import { SesEmailOtpSender } from '../otp/ses-email-otp-sender.adapter';

import { BETTER_AUTH } from './auth.constants';
import { buildBetterAuth, type BetterAuthInstance } from './better-auth.config';

/**
 * Construit l'instance better-auth au boot et l'expose via `BETTER_AUTH`.
 * Factory provider : better-auth renvoie un objet (handler + api), pas une
 * classe.
 *
 * `OTP_SENDER` est câblé ici selon `OTP_DELIVERY_MODE` : `log` (dev, codes
 * dans les logs) ou `notification` (e-mail via Amazon SES, identifiants AWS
 * par la chaîne par défaut du SDK ; le schéma d'env garantit expéditeur et
 * région).
 */
@Module({
  providers: [
    {
      provide: OTP_SENDER,
      inject: [ConfigService, LoggingOtpSenderAdapter],
      useFactory: (
        config: ConfigService<Env, true>,
        logging: LoggingOtpSenderAdapter,
      ): OtpSenderPort => {
        if (config.get('OTP_DELIVERY_MODE', { infer: true }) === 'log') return logging;
        return new SesEmailOtpSender(
          new SESv2Client({
            region: config.get('AWS_REGION', { infer: true }),
            maxAttempts: 2,
          }),
          config.get('OTP_EMAIL_FROM', { infer: true }),
        );
      },
    },
    LoggingOtpSenderAdapter,
    {
      provide: BETTER_AUTH,
      inject: [ConfigService, DRIZZLE_CLIENT, OTP_SENDER],
      useFactory: (
        config: ConfigService<Env, true>,
        db: DrizzleClient,
        otpSender: OtpSenderPort,
      ): BetterAuthInstance =>
        buildBetterAuth(
          {
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET', { infer: true }),
            BETTER_AUTH_URL: config.get('BETTER_AUTH_URL', { infer: true }),
            BETTER_AUTH_TRUSTED_ORIGINS: config.get('BETTER_AUTH_TRUSTED_ORIGINS', { infer: true }),
            OTP_LENGTH: config.get('OTP_LENGTH', { infer: true }),
            OTP_EXPIRES_IN_SECONDS: config.get('OTP_EXPIRES_IN_SECONDS', { infer: true }),
            OTP_ALLOWED_ATTEMPTS: config.get('OTP_ALLOWED_ATTEMPTS', { infer: true }),
            AUTH_RATE_LIMIT_STORAGE: config.get('AUTH_RATE_LIMIT_STORAGE', { infer: true }),
            SESSION_EXPIRES_IN_SECONDS: config.get('SESSION_EXPIRES_IN_SECONDS', { infer: true }),
            SESSION_UPDATE_AGE_SECONDS: config.get('SESSION_UPDATE_AGE_SECONDS', { infer: true }),
          },
          db,
          otpSender,
        ),
    },
  ],
  exports: [BETTER_AUTH, OTP_SENDER],
})
export class AuthModule {}
