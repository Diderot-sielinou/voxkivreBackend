import { Result } from '@/shared/kernel';

import { InvalidUserRoleError } from '../errors/invalid-user-role.error';

/**
 * Rôle applicatif. `user` par défaut ; `admin` réservé à l'exploitation et
 * au futur back-office B2B (Niveau 4). Jamais modifiable par le client.
 */
export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

const ALL_ROLES: readonly string[] = Object.values(UserRole);

export function parseUserRole(raw?: string | null): Result<UserRole, InvalidUserRoleError> {
  if (raw === null || raw === undefined || raw === '') return Result.ok(UserRole.USER);
  if (!ALL_ROLES.includes(raw)) {
    return Result.err(new InvalidUserRoleError(`Unknown user role "${raw}"`));
  }
  return Result.ok(raw as UserRole);
}
