import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { TtsRequestRejectedError, TtsUnavailableError } from '../../domain/errors/tts.errors';
import { type SynthesisResult, type TtsPort } from '../../domain/ports/tts.port';
import { type VoiceId } from '../../domain/voices';

import { type FetchFn, type GoogleAccessToken } from './google-access-token';
import { mp3DurationMs } from './mp3';

const SYNTHESIZE_URL = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const HTTP_BAD_REQUEST = 400;
/** Une requête porte ~1 100 caractères : quelques secondes en temps normal. */
const SYNTHESIZE_TIMEOUT_MS = 30_000;
const LANGUAGE_CODE = 'fr-FR';
const SPEAKING_RATE = 1;

/**
 * Voix WaveNet fr-FR (ADR-0008) associées aux identifiants Voxlivre. Changer
 * l'association change la signature, donc invalide le cache de ces voix.
 */
export const GOOGLE_VOICE_NAMES: ReadonlyMap<string, string> = new Map([
  ['fr-f1', 'fr-FR-Wavenet-A'],
  ['fr-m1', 'fr-FR-Wavenet-B'],
  ['fr-f2', 'fr-FR-Wavenet-C'],
  ['fr-m2', 'fr-FR-Wavenet-D'],
]);

const synthesizeResponse = z.object({
  audioContent: z.string().min(1),
  timepoints: z
    .array(z.object({ markName: z.string(), timeSeconds: z.number().nonnegative().optional() }))
    .optional(),
});

const MARK_TAG = /<mark [^>]*\/>/gu;

/**
 * Google Cloud Text-to-Speech (ADR-0008) par l'API REST v1beta1 — la seule
 * qui renvoie l'horodatage des marques SSML (`enableTimePointing`). Pas de
 * SDK : un `fetch` et un jeton de compte de service suffisent.
 *
 * Erreurs : HTTP 400 (SSML ou paramètres refusés) → `TtsRequestRejectedError`,
 * définitif ; tout le reste (réseau, délai, 401/403, 429, 5xx) →
 * `TtsUnavailableError`, la tâche est réessayée.
 */
export class GoogleTtsAdapter implements TtsPort {
  private readonly logger = new Logger(GoogleTtsAdapter.name);

  constructor(
    private readonly token: GoogleAccessToken,
    private readonly fetchFn: FetchFn,
  ) {}

  engineSignature(voiceId: VoiceId): string {
    return `google-v1beta1|${this.voiceName(voiceId)}|mp3|${String(SPEAKING_RATE)}`;
  }

  async synthesize(input: {
    readonly ssml: string;
    readonly voiceId: VoiceId;
  }): Promise<SynthesisResult> {
    const voiceName = this.voiceName(input.voiceId);
    const response = await this.fetchFn(SYNTHESIZE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token.get()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: { ssml: input.ssml },
        voice: { languageCode: LANGUAGE_CODE, name: voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: SPEAKING_RATE },
        enableTimePointing: ['SSML_MARK'],
      }),
      signal: AbortSignal.timeout(SYNTHESIZE_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new TtsUnavailableError('Google TTS unreachable', { cause: error });
    });

    if (!response.ok) {
      // Le corps d'erreur Google ne contient pas le texte soumis : loggable.
      const body = await response.text();
      const detail = body.slice(0, 500);
      this.logger.error(
        { status: response.status, voiceName, detail },
        'Google TTS request failed',
      );
      const message = `Google TTS answered HTTP ${String(response.status)}`;
      throw response.status === HTTP_BAD_REQUEST
        ? new TtsRequestRejectedError(message)
        : new TtsUnavailableError(message);
    }

    const parsed = synthesizeResponse.safeParse(await response.json());
    if (!parsed.success) throw new TtsUnavailableError('Unexpected Google TTS response');
    const audio = new Uint8Array(Buffer.from(parsed.data.audioContent, 'base64'));
    const durationMs = mp3DurationMs(audio);
    // La facture (observability.md) : caractères du SSML hors marques, non facturées (ADR-0008).
    this.logger.log(
      {
        provider: 'google',
        voiceId: input.voiceId,
        voiceName,
        characters: input.ssml.replaceAll(MARK_TAG, '').length,
        durationMs,
        ok: true,
      },
      'tts.call',
    );
    return {
      audio,
      marks: (parsed.data.timepoints ?? []).map((point) => ({
        name: point.markName,
        timeSeconds: point.timeSeconds ?? 0,
      })),
      durationMs,
    };
  }

  private voiceName(voiceId: VoiceId): string {
    const name = GOOGLE_VOICE_NAMES.get(voiceId);
    // Le domaine n'accepte que des voix de la liste blanche : une voix sans
    // association ici est une erreur de configuration, pas une entrée utilisateur.
    if (name === undefined) throw new TtsRequestRejectedError(`No Google voice for "${voiceId}"`);
    return name;
  }
}
