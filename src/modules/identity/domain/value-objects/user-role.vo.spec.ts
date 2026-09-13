import { parseUserRole, UserRole } from './user-role.vo';

describe('parseUserRole', () => {
  it('defaults to user when empty', () => {
    expect(parseUserRole(null).value).toBe(UserRole.USER);
    expect(parseUserRole().value).toBe(UserRole.USER);
    expect(parseUserRole('').value).toBe(UserRole.USER);
  });

  it('accepts known roles', () => {
    expect(parseUserRole('admin').value).toBe(UserRole.ADMIN);
  });

  it('rejects unknown roles', () => {
    expect(parseUserRole('producer').isErr()).toBe(true);
  });
});
