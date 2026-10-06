import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';
import { createCursorCodec, type CursorEncoder } from '@/shared/kernel';

import { CURSOR_CODEC } from './cursor-codec.constants';
import { resolveCursorSecret } from './cursor-secret';

/**
 * Expose `CURSOR_CODEC` (ADR-0005) à tous les modules paginés : le kernel
 * fournit la factory pure, ce module lui injecte le secret depuis l'env.
 */
@Global()
@Module({
  providers: [
    {
      provide: CURSOR_CODEC,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CursorEncoder<string> =>
        createCursorCodec<string>(
          resolveCursorSecret({
            CURSOR_HMAC_SECRET: config.get('CURSOR_HMAC_SECRET', { infer: true }),
            BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET', { infer: true }),
          }),
        ),
    },
  ],
  exports: [CURSOR_CODEC],
})
export class CursorCodecModule {}
