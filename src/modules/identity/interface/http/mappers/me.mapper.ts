import { hasTechnicalEmail, type User } from '@/modules/identity/domain/entities/user.entity';

import { type MeResponseDto } from '../dto/me-response.dto';

export function toMeResponseDto(user: User): MeResponseDto {
  return {
    id: user.id,
    email: hasTechnicalEmail(user) ? null : user.email,
    emailVerified: hasTechnicalEmail(user) ? false : user.emailVerified,
    phoneNumber: user.phoneNumber,
    phoneNumberVerified: user.phoneNumberVerified,
    role: user.role,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}
