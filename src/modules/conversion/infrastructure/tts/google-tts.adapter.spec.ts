import { createVerify, generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { TtsRequestRejectedError, TtsUnavailableError } from '../../domain/errors/tts.errors';
import { type VoiceId } from '../../domain/voices';

import { type FetchFn, GoogleAccessToken } from './google-access-token';
import { GoogleTtsAdapter } from './google-tts.adapter';
import { silentMp3 } from './mp3';

// Clé générée à l'exécution : aucun secret, même factice, dans le repo (gitleaks).
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDENTIALS = { clientEmail: 'tts@voxlivre.iam.gserviceaccount.com', privateKey: PEM };
const SSML = '<speak><mark name="w0"/>Bonjour <mark name="w1"/>monde.</speak>';
const VOICE = 'fr-m1' as VoiceId;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Faux Google : jeton puis synthèse, réponses scriptées. */
function fakeGoogle(synthesize: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchFn = (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com')) {
      return Promise.resolve(json({ access_token: 'token-1', expires_in: 3600 }));
    }
    return Promise.resolve(synthesize());
  };
  return { calls, fetchFn };
}

describe('GoogleTtsAdapter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls v1beta1 with SSML marks enabled, at speed 1.0, and maps audio + timepoints', async () => {
    const audio = silentMp3(500);
    const { calls, fetchFn } = fakeGoogle(() =>
      json({
        audioContent: Buffer.from(audio).toString('base64'),
        timepoints: [
          { markName: 'w0', timeSeconds: 0.05 },
          { markName: 'w1', timeSeconds: 0.6 },
        ],
      }),
    );
    const tts = new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, fetchFn), fetchFn);
    const result = await tts.synthesize({ ssml: SSML, voiceId: VOICE });

    expect([...result.audio]).toEqual([...audio]);
    expect(result.marks).toEqual([
      { name: 'w0', timeSeconds: 0.05 },
      { name: 'w1', timeSeconds: 0.6 },
    ]);
    expect(result.durationMs).toBe(504);
    const call = calls[1];
    expect(call.url).toBe('https://texttospeech.googleapis.com/v1beta1/text:synthesize');
    expect(call.init.headers).toMatchObject({ authorization: 'Bearer token-1' });
    expect(JSON.parse(call.init.body as string)).toEqual({
      input: { ssml: SSML },
      voice: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-B' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
      enableTimePointing: ['SSML_MARK'],
    });
  });

  it('logs the billed characters (SSML without the free marks)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fetchFn } = fakeGoogle(() => json({ audioContent: 'AA==' }));
    await new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, fetchFn), fetchFn).synthesize({
      ssml: SSML,
      voiceId: VOICE,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        voiceId: 'fr-m1',
        voiceName: 'fr-FR-Wavenet-B',
        characters: '<speak>Bonjour monde.</speak>'.length,
        ok: true,
      }),
      'tts.call',
    );
  });

  it.each([
    [400, TtsRequestRejectedError],
    [403, TtsUnavailableError],
    [429, TtsUnavailableError],
    [503, TtsUnavailableError],
  ])('maps HTTP %i to %p', async (status, expected) => {
    const { fetchFn } = fakeGoogle(() => json({ error: { message: 'nope' } }, status));
    const tts = new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, fetchFn), fetchFn);
    await expect(tts.synthesize({ ssml: SSML, voiceId: VOICE })).rejects.toBeInstanceOf(expected);
  });

  it('turns network failures and unexpected bodies into TtsUnavailableError', async () => {
    const { fetchFn } = fakeGoogle(() => Promise.reject(new Error('ECONNRESET')));
    const tts = new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, fetchFn), fetchFn);
    await expect(tts.synthesize({ ssml: SSML, voiceId: VOICE })).rejects.toBeInstanceOf(
      TtsUnavailableError,
    );
    const odd = fakeGoogle(() => json({ unexpected: true }));
    const tts2 = new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, odd.fetchFn), odd.fetchFn);
    await expect(tts2.synthesize({ ssml: SSML, voiceId: VOICE })).rejects.toBeInstanceOf(
      TtsUnavailableError,
    );
  });

  it('refuses a voice without a Google mapping, and puts the voice name in the signature', async () => {
    const { fetchFn } = fakeGoogle(() => json({}));
    const tts = new GoogleTtsAdapter(new GoogleAccessToken(CREDENTIALS, fetchFn), fetchFn);
    expect(tts.engineSignature(VOICE)).toBe('google-v1beta1|fr-FR-Wavenet-B|mp3|1');
    await expect(tts.synthesize({ ssml: SSML, voiceId: 'xx' as VoiceId })).rejects.toBeInstanceOf(
      TtsRequestRejectedError,
    );
  });
});

describe('GoogleAccessToken', () => {
  it('exchanges a JWT signed with the service account key, then caches the token', async () => {
    let now = 1_800_000_000_000;
    const { calls, fetchFn } = fakeGoogle(() => json({}));
    const token = new GoogleAccessToken(CREDENTIALS, fetchFn, () => now);
    const [a, b] = await Promise.all([token.get(), token.get()]);
    expect([a, b]).toEqual(['token-1', 'token-1']);
    expect(calls).toHaveLength(1); // demandes simultanées : un seul échange

    const form = new URLSearchParams(calls[0].init.body as URLSearchParams);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: CREDENTIALS.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    });

    now += 30 * 60 * 1000;
    await token.get();
    expect(calls).toHaveLength(1); // encore valide
    now += 30 * 60 * 1000;
    await token.get();
    expect(calls).toHaveLength(2); // renouvelé avant expiration
  });

  it('reports token endpoint failures as TtsUnavailableError (retried)', async () => {
    const down: FetchFn = () => Promise.reject(new Error('offline'));
    await expect(new GoogleAccessToken(CREDENTIALS, down).get()).rejects.toBeInstanceOf(
      TtsUnavailableError,
    );
    const refused: FetchFn = () => Promise.resolve(json({ error: 'invalid_grant' }, 400));
    await expect(new GoogleAccessToken(CREDENTIALS, refused).get()).rejects.toBeInstanceOf(
      TtsUnavailableError,
    );
    const odd: FetchFn = () => Promise.resolve(json({ token: 'x' }));
    await expect(new GoogleAccessToken(CREDENTIALS, odd).get()).rejects.toBeInstanceOf(
      TtsUnavailableError,
    );
  });
});
