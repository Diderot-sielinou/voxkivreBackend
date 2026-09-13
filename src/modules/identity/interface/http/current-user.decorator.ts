import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { UnauthorizedError } from '@/shared/kernel';

import { type AuthenticatedRequest, type AuthenticatedUser } from './session.guard';

/**
 * `@CurrentUser() user: AuthenticatedUser` — lit l'identité posée par
 * `SessionGuard`. Throw si le guard n'a pas tourné (oubli de `@UseGuards`) :
 * mieux vaut un 401 qu'un `undefined` qui se propage.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.authUser === undefined) {
      throw new UnauthorizedError('Session required');
    }
    return req.authUser;
  },
);
