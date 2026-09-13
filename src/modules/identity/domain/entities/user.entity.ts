import { type PhoneNumber } from '../value-objects/phone-number.vo';
import { type UserId } from '../value-objects/user-id.vo';
import { type UserRole } from '../value-objects/user-role.vo';

/**
 * Vue domaine de l'utilisateur. La table `user` est **possédée par
 * better-auth** (création, vérification email/téléphone, sessions) ; le
 * domain n'expose qu'une projection immuable de ce qu'il a besoin de savoir.
 *
 * `email` est toujours présent : pour un compte créé par téléphone,
 * better-auth génère un email technique (`<digits>@phone.voxlivre.local`).
 * `hasTechnicalEmail` permet aux mappers de ne pas l'afficher comme réel.
 */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly phoneNumber: PhoneNumber | null;
  readonly phoneNumberVerified: boolean;
  readonly role: UserRole;
  readonly name: string | null;
  readonly createdAt: Date;
}

export const TECHNICAL_EMAIL_DOMAIN = 'phone.voxlivre.local';

export function hasTechnicalEmail(user: Pick<User, 'email'>): boolean {
  return user.email.endsWith(`@${TECHNICAL_EMAIL_DOMAIN}`);
}

/** Email technique déterministe pour un compte créé par téléphone. */
export function technicalEmailFor(phoneNumber: string): string {
  return `${phoneNumber.replace('+', '')}@${TECHNICAL_EMAIL_DOMAIN}`;
}
