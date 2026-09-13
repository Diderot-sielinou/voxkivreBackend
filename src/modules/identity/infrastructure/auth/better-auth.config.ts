import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, emailOTP, openAPI, phoneNumber } from 'better-auth/plugins';

import type { Env } from '@/shared/config';
import type { DrizzleClient } from '@/shared/persistence';

import { technicalEmailFor } from '../../domain/entities/user.entity';
import { type OtpSenderPort } from '../../domain/ports/otp-sender.port';
import { PhoneNumber } from '../../domain/value-objects/phone-number.vo';
import { account, rateLimit, session, user, verification } from '../persistence/schema/auth.schema';

import { AUTH_RATE_LIMIT_DEFAULT, AUTH_RATE_LIMIT_RULES } from './auth-rate-limit.rules';

const log = new Logger('better-auth');

/**
 * Sérialise un Error en suivant `.cause` : Drizzle enveloppe l'erreur
 * Postgres dans `DrizzleQueryError` — la vraie cause (`relation does not
 * exist`, …) n'est que dans `.cause`.
 */
function formatErrorChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current instanceof Error && depth < 5) {
    parts.push(`${current.name}: ${current.message}`);
    const next = (current as { cause?: unknown }).cause;
    if (next !== undefined) parts.push('Caused by:');
    current = next;
    depth += 1;
  }
  return parts.join('\n');
}

type OtpEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'BETTER_AUTH_TRUSTED_ORIGINS'
  | 'OTP_LENGTH'
  | 'OTP_EXPIRES_IN_SECONDS'
  | 'OTP_ALLOWED_ATTEMPTS'
  | 'AUTH_RATE_LIMIT_STORAGE'
  | 'SESSION_EXPIRES_IN_SECONDS'
  | 'SESSION_UPDATE_AGE_SECONDS'
>;

/**
 * Construit l'instance better-auth Voxlivre : OTP email + OTP téléphone,
 * bearer pour le mobile, sessions en DB, rate-limit en DB.
 *
 * Pas d'annotation de retour : better-auth infère un type sur-mesure
 * (plugins + additionalFields) que TS ne peut pas widener sans perdre les
 * routes typées. `BetterAuthInstance` = `ReturnType<typeof buildBetterAuth>`.
 */
export function buildBetterAuth(env: OtpEnv, db: DrizzleClient, otpSender: OtpSenderPort) {
  const isProduction = env.NODE_ENV === 'production';

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, rateLimit },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
    // Aucun mot de passe : OTP uniquement (DEC-09).
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        // `input: false` : jamais settable par le client. DEFAULT 'user' en DB.
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
      },
    },
    session: {
      expiresIn: env.SESSION_EXPIRES_IN_SECONDS,
      updateAge: env.SESSION_UPDATE_AGE_SECONDS,
    },
    rateLimit: {
      // Actif aussi hors prod (better-auth le coupe par défaut en dev) : on
      // veut les mêmes règles partout — les e2e/int les exercent.
      enabled: true,
      // `database` en prod/int (partagé, sans Redis) ; `memory` en e2e.
      storage: env.AUTH_RATE_LIMIT_STORAGE,
      modelName: 'rateLimit',
      window: AUTH_RATE_LIMIT_DEFAULT.window,
      max: AUTH_RATE_LIMIT_DEFAULT.max,
      customRules: { ...AUTH_RATE_LIMIT_RULES },
    },
    advanced: {
      // Le client principal est l'app mobile (bearer). Les cookies ne servent
      // qu'à Swagger UI en dev : `Secure` seulement derrière HTTPS.
      useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    plugins: [
      // OpenAPI des routes auth, mergé dans /docs (cf. swagger.bootstrap). La
      // page de référence interactive est coupée en prod (surface d'API).
      openAPI({ disableDefaultReference: isProduction }),
      // Token de session signé renvoyé dans `set-auth-token` après sign-in ;
      // le mobile le renvoie en `Authorization: Bearer`. `requireSignature` :
      // un token brut de la table `session` qui fuiterait n'est pas rejouable
      // sans BETTER_AUTH_SECRET.
      bearer({ requireSignature: true }),
      emailOTP({
        otpLength: env.OTP_LENGTH,
        expiresIn: env.OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: env.OTP_ALLOWED_ATTEMPTS,
        storeOTP: 'hashed',
        // Redemander un code = nouveau code (l'ancien est invalidé).
        resendStrategy: 'rotate',
        sendVerificationOTP: async ({ email, otp, type }) => {
          await otpSender.send({
            channel: 'email',
            destination: email,
            code: otp,
            purpose: type,
            expiresInSeconds: env.OTP_EXPIRES_IN_SECONDS,
          });
        },
      }),
      phoneNumber({
        otpLength: env.OTP_LENGTH,
        expiresIn: env.OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: env.OTP_ALLOWED_ATTEMPTS,
        phoneNumberValidator: (raw) => PhoneNumber.isValid(raw),
        sendOTP: async ({ phoneNumber: destination, code }) => {
          await otpSender.send({
            channel: 'sms',
            destination,
            code,
            purpose: 'sign-in',
            expiresInSeconds: env.OTP_EXPIRES_IN_SECONDS,
          });
        },
        // Compte créé à la 1re vérification réussie ; better-auth exige un
        // email unique → email technique déterministe (cf. user.entity).
        signUpOnVerification: {
          getTempEmail: (phone) => technicalEmailFor(phone),
          getTempName: (phone) => phone,
        },
      }),
    ],
    logger: {
      level: 'warn',
      log: (level, message, ...args) => {
        const formatted = args
          .map((a) => (a instanceof Error ? formatErrorChain(a) : String(a)))
          .join(' ');
        const line = formatted.length > 0 ? `${message}\n${formatted}` : message;
        switch (level) {
          case 'error': {
            log.error(line);
            break;
          }
          case 'warn': {
            log.warn(line);
            break;
          }
          case 'info': {
            log.log(line);
            break;
          }
          default: {
            log.debug(line);
          }
        }
      },
    },
  });
}

/** Type inféré de l'instance (plugins + additionalFields inclus). */
export type BetterAuthInstance = ReturnType<typeof buildBetterAuth>;
