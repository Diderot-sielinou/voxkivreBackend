export const EMAIL_SENDER = Symbol('EmailSender');

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Texte brut (pas de HTML, pas de lien : meilleure délivrabilité). */
  readonly text: string;
}

/** Envoi d'un e-mail (ADR-0014). Lève en cas d'échec ; le use-case décide. */
export interface EmailSenderPort {
  send(message: EmailMessage): Promise<void>;
}
