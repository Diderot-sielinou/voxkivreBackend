import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { type Env } from '@/shared/config';

import { requestContext } from './request-context';

/**
 * Logger Pino global. JSON en prod (Railway agrège les lignes stdout),
 * pretty en dev. Redaction stricte des champs sensibles (jamais de PII ni
 * de secret dans les logs — OTP, tokens, cookies). Le request-id provient
 * de `requestContext` (ALS) : un log émis depuis n'importe quelle couche
 * embarque le même id que la requête HTTP en cours.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        const level = config.get('LOG_LEVEL', { infer: true }) ?? (isProd ? 'info' : 'debug');

        return {
          pinoHttp: {
            level,
            genReqId: () => requestContext.getRequestId() ?? 'unknown',
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
                },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["set-cookie"]',
                '*.password',
                '*.token',
                '*.accessToken',
                '*.refreshToken',
                '*.secret',
                '*.otp',
                '*.code',
                '*.phone',
                '*.email',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req(req: { method?: string; url?: string; id?: string }) {
                return { method: req.method, url: req.url, id: req.id };
              },
              res(res: { statusCode?: number }) {
                return { statusCode: res.statusCode };
              },
            },
            customLogLevel: (_req: unknown, res: { statusCode: number }, err: unknown) => {
              if (err) return 'error';
              if (res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
