import { ApiProperty } from '@nestjs/swagger';

import { UserRole } from '@/modules/identity/domain/value-objects/user-role.vo';

/**
 * Représentation HTTP de l'utilisateur courant. Jamais de donnée sensible
 * (token, hash, IP). `email` est `null` pour un compte créé par téléphone
 * (l'email technique interne n'est pas exposé).
 */
export class MeResponseDto {
  @ApiProperty({ description: 'Identifiant utilisateur (better-auth)' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'etudiant@univ-yaounde.cm' })
  email!: string | null;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({ nullable: true, example: '+237699000000' })
  phoneNumber!: string | null;

  @ApiProperty()
  phoneNumberVerified!: boolean;

  @ApiProperty({ enum: Object.values(UserRole) })
  role!: UserRole;

  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
