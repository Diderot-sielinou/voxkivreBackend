import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { PurgeOtpDispatchesUseCase } from './application/use-cases/purge-otp-dispatches.use-case';
import { SendOtpUseCase } from './application/use-cases/send-otp.use-case';
import { NOTIFICATION_POLICY, type NotificationPolicy } from './domain/notification-policy';
import { DESTINATION_HASHER } from './domain/ports/destination-hasher.port';
import { EMAIL_SENDER } from './domain/ports/email-sender.port';
import { OTP_DISPATCH_LOG } from './domain/ports/otp-dispatch-log.port';
import { SMS_SENDER } from './domain/ports/sms-sender.port';
import { buildEmailSender, buildSmsSender } from './infrastructure/config/notification.providers';
import { DrizzleOtpDispatchLog } from './infrastructure/persistence/otp-dispatch-log.drizzle-repository';
import { PurgeOtpDispatchesJob } from './infrastructure/scheduling/purge-otp-dispatches.job';
import { HmacDestinationHasher } from './infrastructure/security/hmac-destination-hasher';

/**
 * Module notification (RF-16, ADR-0017) : livraison des codes à usage
 * unique par SMS (Orange) et e-mail (SES), derrière des plafonds anti-abus.
 * Aucune route HTTP : `identity` appelle `SendOtpUseCase` derrière son
 * `OtpSenderPort`. `CLOCK` et `DRIZZLE_CLIENT` viennent des modules globaux.
 */
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      inject: [ConfigService],
      useFactory: buildSmsSender,
    },
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: buildEmailSender,
    },
    {
      provide: DESTINATION_HASHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): HmacDestinationHasher =>
        new HmacDestinationHasher(config.get('BETTER_AUTH_SECRET', { infer: true })),
    },
    {
      provide: NOTIFICATION_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): NotificationPolicy => ({
        smsDailyLimit: config.get('SMS_DAILY_LIMIT', { infer: true }),
      }),
    },
    { provide: OTP_DISPATCH_LOG, useClass: DrizzleOtpDispatchLog },
    SendOtpUseCase,
    PurgeOtpDispatchesUseCase,
    PurgeOtpDispatchesJob,
  ],
  exports: [SendOtpUseCase],
})
export class NotificationModule {}
