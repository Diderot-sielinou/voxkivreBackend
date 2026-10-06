import { createSign } from 'node:crypto';

import { z } from 'zod';

import { TtsUnavailableError } from '../../domain/errors/tts.errors';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_LIFETIME_SECONDS = 3600;
/** Renouvelé une minute avant l'expiration annoncée. */
const REFRESH_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 10_000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** `fetch` restreint à ce qu'utilisent les adapters Google (injectable en test). */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ServiceAccountCredentials {
  readonly clientEmail: string;
  readonly privateKey: string;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Jeton OAuth d'un compte de service Google (flux « JWT bearer », RFC 7523),
 * sans SDK : un JWT signé RS256 avec la clé du compte est échangé contre un
 * jeton d'accès d'une heure, gardé en mémoire et renouvelé avant expiration.
 * Les demandes simultanées partagent le même échange.
 */
export class GoogleAccessToken {
  private cached: { readonly token: string; readonly expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly credentials: ServiceAccountCredentials,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.cached !== null && this.now() < this.cached.expiresAt - REFRESH_MARGIN_MS) {
      return this.cached.token;
    }
    this.pending ??= this.exchange().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async exchange(): Promise<string> {
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.signedAssertion(),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new TtsUnavailableError('Google OAuth token endpoint unreachable', { cause: error });
    });
    if (!response.ok) {
      throw new TtsUnavailableError(
        `Google OAuth token request failed (HTTP ${String(response.status)})`,
      );
    }
    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new TtsUnavailableError('Unexpected Google OAuth token response');
    this.cached = {
      token: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1000,
    };
    return parsed.data.access_token;
  }

  private signedAssertion(): string {
    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.credentials.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + TOKEN_LIFETIME_SECONDS,
      }),
    );
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.credentials.privateKey);
    return `${header}.${claims}.${base64Url(signature)}`;
  }
}
