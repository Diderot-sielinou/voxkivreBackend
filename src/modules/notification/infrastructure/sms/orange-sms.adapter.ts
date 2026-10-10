import { z } from 'zod';

import { type SmsSenderPort } from '../../domain/ports/sms-sender.port';

/** Adresse d'expéditeur du Cameroun imposée par l'API Orange (`tel:+2370000`). */
const CAMEROON_SENDER_ADDRESS = 'tel:+2370000';

/** Renouveler le jeton une minute avant son expiration (horloges, latence). */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** Un appel au fournisseur ne bloque pas la requête de connexion plus longtemps. */
const REQUEST_TIMEOUT_MS = 5000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  // L'API renvoie la durée en chaîne (« 3600 »).
  expires_in: z.coerce.number().int().positive(),
});

export interface OrangeSmsCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface OrangeSmsOptions {
  /** Nom d'expéditeur approuvé par Orange (sinon : numéro par défaut). */
  readonly senderName?: string;
  /** Injectables pour les tests (serveur local, horloge). */
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Échec d'un appel à Orange. Le statut HTTP seulement : le corps d'une
 * réponse d'erreur peut citer le numéro du destinataire.
 */
export class OrangeSmsError extends Error {
  override readonly name = 'OrangeSmsError';

  constructor(
    readonly step: 'token' | 'send',
    readonly status: number | undefined,
  ) {
    const httpStatus = status === undefined ? '' : ` (HTTP ${String(status)})`;
    super(`Orange SMS ${step} failed${httpStatus}`);
  }
}

/**
 * SMS par l'API Orange Cameroun (ADR-0017) : jeton OAuth2
 * `client_credentials` (1 h, mis en cache), puis
 * `POST /smsmessaging/v1/outbound/tel%3A%2B2370000/requests` → 201. Tous les
 * opérateurs camerounais sont atteints ; l'API limite à 5 SMS/s.
 */
export class OrangeSmsAdapter implements SmsSenderPort {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private token: { readonly value: string; readonly expiresAt: number } | null = null;

  constructor(
    private readonly credentials: OrangeSmsCredentials,
    private readonly options: OrangeSmsOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://api.orange.com';
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async send(to: string, text: string): Promise<void> {
    const first = await this.post(to, text, await this.accessToken());
    if (first.status === 201) return;
    // Jeton révoqué ou expiré plus tôt que prévu : un seul nouvel essai.
    if (first.status === 401) {
      this.token = null;
      const retry = await this.post(to, text, await this.accessToken());
      if (retry.status === 201) return;
      throw new OrangeSmsError('send', retry.status);
    }
    throw new OrangeSmsError('send', first.status);
  }

  private post(to: string, text: string, token: string): Promise<Response> {
    const sender = encodeURIComponent(CAMEROON_SENDER_ADDRESS);
    return this.fetchFn(`${this.baseUrl}/smsmessaging/v1/outbound/${sender}/requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outboundSMSMessageRequest: {
          address: `tel:${to}`,
          senderAddress: CAMEROON_SENDER_ADDRESS,
          ...(this.options.senderName === undefined ? {} : { senderName: this.options.senderName }),
          outboundSMSTextMessage: { message: text },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token !== null && this.token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > this.now()) {
      return this.token.value;
    }
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');
    const response = await this.fetchFn(`${this.baseUrl}/oauth/v3/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) throw new OrangeSmsError('token', response.status);
    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new OrangeSmsError('token', response.status);
    this.token = {
      value: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1000,
    };
    return this.token.value;
  }
}
