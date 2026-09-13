import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type User } from '../../domain/entities/user.entity';
import { type UserQueryPort } from '../../domain/ports/user-query.port';
import {
  PhoneNumber,
  type PhoneNumber as PhoneNumberType,
} from '../../domain/value-objects/phone-number.vo';
import { UserId, type UserId as UserIdType } from '../../domain/value-objects/user-id.vo';
import { parseUserRole, UserRole } from '../../domain/value-objects/user-role.vo';

import { user } from './schema/auth.schema';

function toPhoneOrNull(raw: string): PhoneNumberType | null {
  const r = PhoneNumber.of(raw);
  return r.isOk() ? r.value : null;
}

@Injectable()
export class DrizzleUserQuery implements UserQueryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findById(id: UserIdType): Promise<User | null> {
    const rows = await this.db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        phoneNumber: user.phoneNumber,
        phoneNumberVerified: user.phoneNumberVerified,
        role: user.role,
        name: user.name,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    const row = rows.at(0);
    if (row === undefined) return null;

    // Une valeur DB hors référentiel est un bug de migration, pas une erreur
    // métier : on dégrade en `user` plutôt que de rendre le compte inutilisable.
    const phone = row.phoneNumber === null ? null : toPhoneOrNull(row.phoneNumber);
    return {
      id: UserId.of(row.id),
      email: row.email,
      emailVerified: row.emailVerified,
      phoneNumber: phone,
      phoneNumberVerified: row.phoneNumberVerified,
      role: parseUserRole(row.role).unwrapOr(UserRole.USER),
      // better-auth impose `name` NOT NULL ; pour un compte téléphone c'est
      // le numéro lui-même (getTempName) → on ne l'expose pas comme nom.
      name:
        row.name === '' || (row.phoneNumber !== null && row.name === row.phoneNumber)
          ? null
          : row.name,
      createdAt: row.createdAt,
    };
  }
}
