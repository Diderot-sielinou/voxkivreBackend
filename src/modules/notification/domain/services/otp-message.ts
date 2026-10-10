import { type OtpDispatch } from '../otp-dispatch';

/** Objet de l'e-mail selon la raison de l'envoi (types better-auth). */
const EMAIL_SUBJECTS: ReadonlyMap<string, string> = new Map([
  ['sign-in', 'Votre code de connexion Voxlivre'],
  ['email-verification', 'Vérifiez votre adresse e-mail Voxlivre'],
  ['forget-password', 'Votre code Voxlivre'],
]);

const DEFAULT_SUBJECT = 'Votre code Voxlivre';

function validityMinutes(dispatch: OtpDispatch): string {
  return String(Math.max(1, Math.round(dispatch.expiresInSeconds / 60)));
}

/**
 * SMS court : un seul segment de 160 caractères GSM-7 (é, à sont dans
 * l'alphabet de base ; ê, ç minuscule non — ils feraient passer le message
 * en UCS-2, 70 caractères). Rappel de ne pas partager le code (hameçonnage).
 */
export function otpSmsText(dispatch: OtpDispatch): string {
  return (
    `Voxlivre : votre code est ${dispatch.code}. ` +
    `Valable ${validityMinutes(dispatch)} min. Ne le communiquez à personne.`
  );
}

/** E-mail en texte brut, sans lien ni image (délivrabilité, ADR-0017). */
export function otpEmail(dispatch: OtpDispatch): { subject: string; text: string } {
  return {
    subject: EMAIL_SUBJECTS.get(dispatch.purpose) ?? DEFAULT_SUBJECT,
    text:
      `Votre code Voxlivre : ${dispatch.code}\n\n` +
      `Il est valable ${validityMinutes(dispatch)} minutes et ne peut servir qu'une fois.\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  };
}
