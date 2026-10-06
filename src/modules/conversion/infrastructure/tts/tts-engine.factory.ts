import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type TtsPort } from '../../domain/ports/tts.port';

import { FakeTtsAdapter } from './fake-tts.adapter';
import { type FetchFn, GoogleAccessToken } from './google-access-token';
import { GoogleTtsAdapter } from './google-tts.adapter';

/** `fetch` global, lié explicitement (jamais appelé comme méthode d'un adapter). */
const fetchFn: FetchFn = (url, init) => fetch(url, init);

/**
 * Google si le compte de service est configuré, sinon le moteur factice
 * (dev, CI). En production, `PRODUCTION_RULES` impose le compte de service :
 * impossible de livrer du silence par erreur.
 */
export function buildTtsEngine(config: ConfigService<Env, true>): TtsPort {
  const clientEmail = config.get('GOOGLE_TTS_CLIENT_EMAIL', { infer: true });
  const privateKey = config.get('GOOGLE_TTS_PRIVATE_KEY', { infer: true });
  if (clientEmail === undefined || privateKey === undefined) {
    new Logger('TtsEngine').warn(
      'GOOGLE_TTS_* not configured: using the fake TTS engine (silence)',
    );
    return new FakeTtsAdapter();
  }
  return new GoogleTtsAdapter(new GoogleAccessToken({ clientEmail, privateKey }, fetchFn), fetchFn);
}
