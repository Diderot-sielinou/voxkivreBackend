import { type User } from '../../domain/entities/user.entity';
import { IDENTITY_ERROR_CODES } from '../../domain/errors/error-codes';
import { type UserQueryPort } from '../../domain/ports/user-query.port';
import { UserId } from '../../domain/value-objects/user-id.vo';
import { UserRole } from '../../domain/value-objects/user-role.vo';

import { GetCurrentUserUseCase } from './get-current-user.use-case';

const USER: User = {
  id: UserId.of('u1'),
  email: 'a@b.cm',
  emailVerified: true,
  phoneNumber: null,
  phoneNumberVerified: false,
  role: UserRole.USER,
  name: null,
  createdAt: new Date('2026-09-13T00:00:00Z'),
};

describe('GetCurrentUserUseCase', () => {
  it('returns the user when found', async () => {
    const users: UserQueryPort = { findById: () => Promise.resolve(USER) };
    const r = await new GetCurrentUserUseCase(users).execute(UserId.of('u1'));
    expect(r.value).toBe(USER);
  });

  it('returns USER_NOT_FOUND when missing', async () => {
    const users: UserQueryPort = { findById: () => Promise.resolve(null) };
    const r = await new GetCurrentUserUseCase(users).execute(UserId.of('ghost'));
    expect(r.isErr()).toBe(true);
    expect(r.error.code).toBe(IDENTITY_ERROR_CODES.USER_NOT_FOUND);
    expect(r.error.details).toEqual({ userId: 'ghost' });
  });
});
