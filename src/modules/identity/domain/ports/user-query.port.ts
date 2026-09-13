import { type User } from '../entities/user.entity';
import { type UserId } from '../value-objects/user-id.vo';

export const USER_QUERY = Symbol('UserQuery');

/** Lecture seule de l'utilisateur (la table est possédée par better-auth). */
export interface UserQueryPort {
  findById(id: UserId): Promise<User | null>;
}
