export const SMS_SENDER = Symbol('SmsSender');

/**
 * Envoi d'un SMS (ADR-0017). Lève en cas d'échec (fournisseur en panne,
 * refus, non configuré) : le use-case décide quoi en faire. Changer de
 * fournisseur (Orange → WhatsApp, LMT, AWS) = un nouvel adapter (RNF-17).
 */
export interface SmsSenderPort {
  /** `to` : numéro E.164. `text` : message complet, déjà composé. */
  send(to: string, text: string): Promise<void>;
}
