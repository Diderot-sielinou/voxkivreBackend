import { type Brand } from '@/shared/kernel';

/**
 * Propriétaire d'un document = identifiant utilisateur better-auth (string
 * opaque). Type propre au module : `document` ne dépend pas du domaine
 * `identity`, il reçoit l'identité de la session en argument.
 */
export type OwnerId = Brand<string, 'OwnerId'>;

export const OwnerId = {
  of(raw: string): OwnerId {
    return raw as OwnerId;
  },
} as const;
