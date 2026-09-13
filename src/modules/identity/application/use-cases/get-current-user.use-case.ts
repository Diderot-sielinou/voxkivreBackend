import { Inject, Injectable } from '@nestjs/common';

import { Result } from '@/shared/kernel';

import { type User } from '../../domain/entities/user.entity';
import { UserNotFoundError } from '../../domain/errors/user-not-found.error';
import { USER_QUERY, type UserQueryPort } from '../../domain/ports/user-query.port';
import { type UserId } from '../../domain/value-objects/user-id.vo';

/**
 * `GET /v1/me` : relit l'utilisateur en base plutôt que de renvoyer la
 * session brute better-auth — la session peut être en avance/retard sur les
 * champs métier (rôle, vérification téléphone) et on veut UNE projection.
 */
@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(USER_QUERY) private readonly users: UserQueryPort) {}

  async execute(userId: UserId): Promise<Result<User, UserNotFoundError>> {
    const user = await this.users.findById(userId);
    return user === null ? Result.err(new UserNotFoundError(userId)) : Result.ok(user);
  }
}
