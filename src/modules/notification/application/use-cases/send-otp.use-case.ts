import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { NOTIFICATION_POLICY, type NotificationPolicy } from '../../domain/notification-policy';
import { type OtpDispatch, type OtpDispatchOutcome } from '../../domain/otp-dispatch';
import {
  DESTINATION_HASHER,
  type DestinationHasherPort,
} from '../../domain/ports/destination-hasher.port';
import { EMAIL_SENDER, type EmailSenderPort } from '../../domain/ports/email-sender.port';
import {
  OTP_DISPATCH_LOG,
  type OtpDispatchLogPort,
} from '../../domain/ports/otp-dispatch-log.port';
import { SMS_SENDER, type SmsSenderPort } from '../../domain/ports/sms-sender.port';
import {
  crossesDailyAlert,
  oneHourBefore,
  refusalFor,
  startOfUtcDay,
} from '../../domain/services/dispatch-policy';
import { maskDestination } from '../../domain/services/mask-destination';
import { otpEmail, otpSmsText } from '../../domain/services/otp-message';

/**
 * Livre un code à usage unique par SMS ou e-mail (ADR-0017), derrière les
 * plafonds anti-abus. **Ne lève jamais** : `identity` traduit le résultat
 * (429 si `rate_limited`). Jamais de code ni de destination en clair dans
 * les logs (destination masquée).
 *
 * L'envoi est inscrit au journal **avant** l'appel au fournisseur : deux
 * requêtes simultanées se voient (au plus un léger dépassement), et un
 * échec consomme quand même une tentative — l'utilisateur en a 3 par heure.
 */
@Injectable()
export class SendOtpUseCase {
  private readonly logger = new Logger(SendOtpUseCase.name);

  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(EMAIL_SENDER) private readonly email: EmailSenderPort,
    @Inject(OTP_DISPATCH_LOG) private readonly log: OtpDispatchLogPort,
    @Inject(DESTINATION_HASHER) private readonly hasher: DestinationHasherPort,
    @Inject(NOTIFICATION_POLICY) private readonly policy: NotificationPolicy,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(dispatch: OtpDispatch): Promise<OtpDispatchOutcome> {
    const now = this.clock.now();
    const context = {
      channel: dispatch.channel,
      purpose: dispatch.purpose,
      destination: maskDestination(dispatch.destination),
    };
    try {
      const key = this.hasher.keyOf(dispatch.destination);
      const smsSentToday =
        dispatch.channel === 'sms'
          ? await this.log.countForChannelSince('sms', startOfUtcDay(now))
          : 0;
      const refusal = refusalFor({
        channel: dispatch.channel,
        sentToDestinationLastHour: await this.log.countForDestinationSince(key, oneHourBefore(now)),
        smsSentToday,
        smsDailyLimit: this.policy.smsDailyLimit,
      });
      if (refusal !== null) {
        const level = refusal === 'sms_daily_limit' ? 'error' : 'warn';
        this.logger[level]({ ...context, refusal }, 'otp.rate_limited');
        return 'rate_limited';
      }

      await this.log.record(dispatch.channel, key, now);
      if (dispatch.channel === 'sms') {
        if (crossesDailyAlert(smsSentToday + 1, this.policy.smsDailyLimit)) {
          this.logger.warn(
            { smsSentToday: smsSentToday + 1, smsDailyLimit: this.policy.smsDailyLimit },
            'SMS daily limit nearly reached',
          );
        }
        await this.sms.send(dispatch.destination, otpSmsText(dispatch));
      } else {
        await this.email.send({ to: dispatch.destination, ...otpEmail(dispatch) });
      }
      this.logger.log(context, 'otp.sent');
      return 'sent';
    } catch (error) {
      // Le nom, l'étape et le statut seulement : un message de fournisseur peut
      // contenir la destination (constaté avec SES, ADR-0014). L'étape sépare
      // des identifiants refusés (`token`) d'un envoi refusé (`send`).
      const details = error as {
        name?: string;
        step?: string;
        status?: number;
        $metadata?: { httpStatusCode?: number };
      };
      this.logger.error(
        {
          ...context,
          errorName: details.name,
          step: details.step,
          httpStatus: details.status ?? details.$metadata?.httpStatusCode,
        },
        'otp.delivery_failed',
      );
      return 'failed';
    }
  }
}
