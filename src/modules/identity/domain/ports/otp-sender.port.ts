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
 * Résultat d'une livraison (ADR-0017) : `rate_limited` → better-auth répond
 * 429 ; `failed` → l'utilisateur redemande un code (pas d'erreur 500).
 */
export type OtpDeliveryOutcome = 'sent' | 'failed' | 'rate_limited';

/**
 * Port de livraison d'OTP. Implémentations : log (dev) et module
 * notification (SMS Orange, e-mail SES). **Ne lève jamais** : better-auth
 * renverrait une 500 ; le résultat dit ce qui s'est passé.
 */
export interface OtpSenderPort {
  send(delivery: OtpDelivery): Promise<OtpDeliveryOutcome>;
}
