import { Module } from '@nestjs/common';

import { GetCurrentUserUseCase } from './application/use-cases/get-current-user.use-case';
import { USER_QUERY } from './domain/ports/user-query.port';
import { AuthModule } from './infrastructure/auth/auth.module';
import { DrizzleUserQuery } from './infrastructure/persistence/user.drizzle-query';
import { MeController } from './interface/http/me.controller';
import { SessionGuard } from './interface/http/session.guard';

/**
 * Module identity (RF-16, DEC-09) : authentification OTP email/téléphone via
 * better-auth (`AuthModule`), `SessionGuard` réutilisable par les autres
 * modules, `GET /v1/me`.
 */
@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [
    { provide: USER_QUERY, useClass: DrizzleUserQuery },
    GetCurrentUserUseCase,
    SessionGuard,
  ],
  exports: [AuthModule, SessionGuard],
})
export class IdentityModule {}
