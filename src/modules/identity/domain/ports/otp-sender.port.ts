export const OTP_SENDER = Symbol('OtpSender');

export type OtpChannel = 'email' | 'sms';

/** Ce que better-auth demande : "livre ce code à cette destination". */
export interface OtpDelivery {
  readonly channel: OtpChannel;
  /** Email ou numéro E.164 selon `channel`. */
  readonly destination: string;
  readonly code: string;
  /** Raison de l'envoi (sign-in, vérification, changement d'email…). */
  readonly purpose: string;
  readonly expiresInSeconds: number;
}

/**
 * Port de livraison d'OTP. Implémentations : log (dev), puis email/SMS via
 * le module notification. Ne throw pas pour une destination injoignable —
 * better-auth renverrait une 500 ; l'adapter loggue et laisse l'utilisateur
 * redemander un code.
 */
export interface OtpSenderPort {
  send(delivery: OtpDelivery): Promise<void>;
}
