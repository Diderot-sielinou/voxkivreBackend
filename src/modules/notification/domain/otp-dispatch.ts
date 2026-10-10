/** Canal de livraison d'un code à usage unique. */
export type OtpChannel = 'email' | 'sms';

/** Un code à livrer (ce que demande `identity`, ADR-0004). */
export interface OtpDispatch {
  readonly channel: OtpChannel;
  /** E-mail, ou numéro E.164 (mobile camerounais, ADR-0017). */
  readonly destination: string;
  readonly code: string;
  /** Raison de l'envoi (`sign-in`, `email-verification`…). */
  readonly purpose: string;
  readonly expiresInSeconds: number;
}

/**
 * Résultat d'un envoi (ADR-0017) :
 * - `sent`         : remis au fournisseur ;
 * - `failed`       : fournisseur en panne ou non configuré — l'utilisateur redemande ;
 * - `rate_limited` : plafond atteint — `identity` répond 429.
 */
export type OtpDispatchOutcome = 'sent' | 'failed' | 'rate_limited';
