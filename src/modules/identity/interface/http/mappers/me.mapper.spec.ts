import { type User, technicalEmailFor } from '@/modules/identity/domain/entities/user.entity';
import { PhoneNumber } from '@/modules/identity/domain/value-objects/phone-number.vo';
import { UserId } from '@/modules/identity/domain/value-objects/user-id.vo';
import { UserRole } from '@/modules/identity/domain/value-objects/user-role.vo';

import { toMeResponseDto } from './me.mapper';

const BASE: User = {
  id: UserId.of('u1'),
  email: 'a@b.cm',
  emailVerified: true,
  phoneNumber: null,
  phoneNumberVerified: false,
  role: UserRole.USER,
  name: 'Ada',
  createdAt: new Date('2026-09-13T10:00:00.000Z'),
};

describe('toMeResponseDto', () => {
  it('exposes a real email', () => {
    expect(toMeResponseDto(BASE)).toEqual({
      id: 'u1',
      email: 'a@b.cm',
      emailVerified: true,
      phoneNumber: null,
      phoneNumberVerified: false,
      role: 'user',
      name: 'Ada',
      createdAt: '2026-09-13T10:00:00.000Z',
    });
  });

  it('hides the technical email of a phone-created account', () => {
    const phone = PhoneNumber.of('+237699000000').value;
    const dto = toMeResponseDto({
      ...BASE,
      email: technicalEmailFor(phone),
      emailVerified: true,
      phoneNumber: phone,
      phoneNumberVerified: true,
      name: null,
    });
    expect(dto.email).toBeNull();
    expect(dto.emailVerified).toBe(false);
    expect(dto.phoneNumber).toBe('+237699000000');
    expect(dto.phoneNumberVerified).toBe(true);
  });
});
