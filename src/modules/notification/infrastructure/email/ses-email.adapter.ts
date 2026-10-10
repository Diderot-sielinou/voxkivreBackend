import { type SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type OnApplicationShutdown } from '@nestjs/common';

import { type EmailMessage, type EmailSenderPort } from '../../domain/ports/email-sender.port';

/** Jeu de caractères attendu par l'API SES (valeur IANA, pas un encodage Node). */
// eslint-disable-next-line unicorn/text-encoding-identifier-case -- valeur imposée par l'API SES
const CHARSET = 'UTF-8';

/**
 * Nom affiché dans la boîte de réception (ADR-0018) : la marque du produit,
 * pas une configuration — `OTP_EMAIL_FROM` reste une adresse nue.
 */
const SENDER_DISPLAY_NAME = 'Voxlivre';

/** Sous-ensemble du client SES utilisé : injectable en test. */
export type SesSender = Pick<SESv2Client, 'send'> & Partial<Pick<SESv2Client, 'destroy'>>;

/**
 * E-mail par Amazon SES (ADR-0014), identifiants par la chaîne par défaut du
 * SDK (rôle d'instance). Lève en cas d'échec : le use-case logge (sans le
 * message du SDK, qui recopie le destinataire) et répond `failed`.
 */
export class SesEmailAdapter implements EmailSenderPort, OnApplicationShutdown {
  constructor(
    private readonly client: SesSender,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${SENDER_DISPLAY_NAME} <${this.from}>`,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: CHARSET },
            Body: { Text: { Data: message.text, Charset: CHARSET } },
          },
        },
      }),
    );
  }

  onApplicationShutdown(): void {
    this.client.destroy?.();
  }
}
