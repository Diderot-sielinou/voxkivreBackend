import { PollyClient } from '@aws-sdk/client-polly';
import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { NodeHttpHandler } from '@smithy/node-http-handler';

import { type Env } from '@/shared/config';

import { type TtsPort } from '../../domain/ports/tts.port';

import { FakeTtsAdapter } from './fake-tts.adapter';
import { PollyTtsAdapter } from './polly-tts.adapter';

/**
 * Moteur choisi par `TTS_PROVIDER` (ADR-0013). Polly : identifiants par la
 * chaîne par défaut du SDK ; délais courts et un seul nouvel essai côté SDK,
 * la file BullMQ se charge des suivants. En production, `PRODUCTION_RULES`
 * impose `polly` : impossible de livrer du silence par erreur.
 *
 * **HTTP/1.1 imposé** : le client Polly récent utilise HTTP/2 par défaut (pour
 * la synthèse en flux) ; nos requêtes simultanées partagent alors une seule
 * session, que Polly coupe (`NGHTTP2_REFUSED_STREAM`, `ERR_HTTP2_SESSION_ERROR`)
 * — constaté à l'essai réel. Avec HTTP/1.1, chaque requête a sa connexion.
 */
export function buildTtsEngine(config: ConfigService<Env, true>): TtsPort {
  if (config.get('TTS_PROVIDER', { infer: true }) === 'fake') {
    new Logger('TtsEngine').warn('TTS_PROVIDER=fake: using the fake TTS engine (silence)');
    return new FakeTtsAdapter();
  }
  return new PollyTtsAdapter(
    new PollyClient({
      region: config.get('AWS_REGION', { infer: true }),
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 3000, requestTimeout: 30_000 }),
    }),
  );
}
