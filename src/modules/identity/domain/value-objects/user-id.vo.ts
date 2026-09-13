import { type Brand } from '@/shared/kernel';

/**
 * Identifiant utilisateur. Émis par better-auth (string opaque, pas
 * forcément un UUID) — on ne le valide pas, on le marque.
 */
export type UserId = Brand<string, 'UserId'>;

export const UserId = {
  of(raw: string): UserId {
    return raw as UserId;
  },
} as const;
