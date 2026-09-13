import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { type Request } from 'express';

// Exception ADR-0001 (whitelistée dans eslint.config.mjs) : `@UseGuards(X)`
// exige une référence de classe directe, et ce guard EST la glue
// Express ↔ better-auth. Import du token depuis `auth.constants` (pas du
// module) pour éviter tout cycle.
import { BETTER_AUTH } from '@/modules/identity/infrastructure/auth/auth.constants';
import { type BetterAuthInstance } from '@/modules/identity/infrastructure/auth/better-auth.config';
import { UnauthorizedError } from '@/shared/kernel';

import { parseUserRole, UserRole } from '../../domain/value-objects/user-role.vo';

/** Identité posée sur la requête par `SessionGuard`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

/**
 * Valide une session better-auth (bearer signé du mobile, ou cookie de
 * Swagger UI) et attache `req.authUser`. Sinon `UnauthorizedError` → 401
 * Problem Details via le filter global.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (result?.user === undefined) {
      throw new UnauthorizedError('Session required');
    }

    const role = parseUserRole((result.user as { role?: string | null }).role);
    req.authUser = {
      id: result.user.id,
      email: result.user.email,
      role: role.isOk() ? role.value : UserRole.USER,
    };
    return true;
  }
}
