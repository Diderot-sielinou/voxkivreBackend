import { type SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

import { type OtpDelivery, type OtpSenderPort } from '../../domain/ports/otp-sender.port';

/** Objet du message selon la raison de l'envoi (types better-auth). */
const SUBJECTS: ReadonlyMap<string, string> = new Map([
  ['sign-in', 'Votre code de connexion Voxlivre'],
  ['email-verification', 'Vérifiez votre adresse e-mail Voxlivre'],
  ['forget-password', 'Votre code Voxlivre'],
]);

/**
 * Jeu de caractères attendu par l'API SES (valeur IANA, pas un encodage Node).
 */
// eslint-disable-next-line unicorn/text-encoding-identifier-case -- valeur imposée par l'API SES
const CHARSET = 'UTF-8';

/** Sous-ensemble du client SES utilisé : injectable en test. */
export type SesSender = Pick<SESv2Client, 'send'> & Partial<Pick<SESv2Client, 'destroy'>>;

/**
 * Livraison des OTP par **e-mail via Amazon SES** (RF-16, ADR-0012) : mode
 * `OTP_DELIVERY_MODE=notification`. Identifiants AWS par la chaîne par
 * défaut du SDK (rôle d'instance en production) ; expéditeur = identité
 * vérifiée dans SES.
 *
 * Contrat du port : **ne lève jamais** (better-auth renverrait une 500) — un
 * échec est loggé, l'utilisateur redemande un code. Le code n'apparaît dans
 * aucun log. Le canal SMS n'est pas encore branché (SNS, plus tard) : la
 * demande est signalée sans le code.
 */
export class SesEmailOtpSender implements OtpSenderPort, OnApplicationShutdown {
  private readonly logger = new Logger(SesEmailOtpSender.name);

  constructor(
    private readonly client: SesSender,
    private readonly from: string,
  ) {}

  async send(delivery: OtpDelivery): Promise<void> {
    if (delivery.channel !== 'email') {
      this.logger.warn(
        { channel: delivery.channel, purpose: delivery.purpose },
        'OTP not delivered: SMS delivery is not configured yet',
      );
      return;
    }
    const minutes = Math.max(1, Math.round(delivery.expiresInSeconds / 60));
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [delivery.destination] },
          Content: {
            Simple: {
              Subject: {
                Data: SUBJECTS.get(delivery.purpose) ?? 'Votre code Voxlivre',
                Charset: CHARSET,
              },
              Body: {
                Text: {
                  Data:
                    `Votre code Voxlivre : ${delivery.code}\n\n` +
                    `Il est valable ${String(minutes)} minutes et ne peut servir qu'une fois.\n` +
                    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
                  Charset: CHARSET,
                },
              },
            },
          },
        }),
      );
      this.logger.log({ channel: 'email', purpose: delivery.purpose }, 'otp.sent');
    } catch (error) {
      const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      // Ni le code ni l'adresse : seulement de quoi diagnostiquer (bac à sable,
      // identité…). Pas le `message` du SDK — SES y recopie le destinataire.
      this.logger.error(
        {
          errorName: details.name,
          httpStatus: details.$metadata?.httpStatusCode,
          purpose: delivery.purpose,
        },
        'OTP e-mail delivery failed',
      );
    }
  }

  onApplicationShutdown(): void {
    this.client.destroy?.();
  }
}
