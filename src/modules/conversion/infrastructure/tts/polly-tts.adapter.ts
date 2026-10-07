import {
  type Engine,
  type PollyClient,
  type VoiceId as PollyVoiceId,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandOutput,
} from '@aws-sdk/client-polly';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { z } from 'zod';

import { TtsRequestRejectedError, TtsUnavailableError } from '../../domain/errors/tts.errors';
import {
  type SynthesisMark,
  type SynthesisResult,
  type TtsPort,
} from '../../domain/ports/tts.port';
import { type VoiceId } from '../../domain/voices';

import { mp3DurationMs } from './mp3';

/** Un seul format pour toutes les voix : des segments concaténables sans surprise (ADR-0011). */
const SAMPLE_RATE = '24000';

interface PollyVoice {
  readonly name: PollyVoiceId;
  readonly engine: Extract<Engine, 'neural' | 'standard'>;
}

/**
 * Voix Voxlivre → voix Polly fr-FR (ADR-0013), vérifiées dans eu-west-3 avec
 * `polly describe-voices`. Changer une association change la signature, donc
 * invalide le cache de cette voix.
 */
export const POLLY_VOICES: ReadonlyMap<string, PollyVoice> = new Map<string, PollyVoice>([
  ['fr-f1', { name: 'Lea', engine: 'neural' }],
  ['fr-m1', { name: 'Remi', engine: 'neural' }],
  ['fr-f2', { name: 'Celine', engine: 'standard' }],
  ['fr-m2', { name: 'Mathieu', engine: 'standard' }],
]);

/**
 * Erreurs de requête (HTTP 400) : réessayer ne changera rien. Tout le reste
 * (limitation de débit, panne du service, réseau, identifiants) est une panne
 * transitoire.
 */
const REJECTED_ERRORS: ReadonlySet<string> = new Set([
  'InvalidSsmlException',
  'TextLengthExceededException',
  'SsmlMarksNotSupportedForTextTypeException',
  'MarksNotSupportedForFormatException',
  'EngineNotSupportedException',
  'LanguageNotSupportedException',
  'InvalidSampleRateException',
  'ValidationException',
]);

/** Une ligne du flux JSON des Speech Marks (`application/x-json-stream`). */
const speechMark = z.object({
  time: z.number().nonnegative(),
  type: z.string(),
  value: z.string(),
});

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Sous-ensemble du client Polly utilisé : injectable en test. */
export type PollySender = Pick<PollyClient, 'send'> & Partial<Pick<PollyClient, 'destroy'>>;

/**
 * Amazon Polly (ADR-0013) derrière le `TtsPort` : par segment, deux requêtes
 * en parallèle — l'audio MP3 et les Speech Marks de type `ssml` (nos marques
 * `w<i>`). Les identifiants viennent de la chaîne par défaut du SDK (profil
 * en local, rôle d'instance en production) : aucune clé dans l'application.
 */
export class PollyTtsAdapter implements TtsPort, OnApplicationShutdown {
  private readonly logger = new Logger(PollyTtsAdapter.name);

  constructor(private readonly client: PollySender) {}

  engineSignature(voiceId: VoiceId): string {
    const voice = this.voice(voiceId);
    return `polly|${voice.engine}|${voice.name}|mp3|${SAMPLE_RATE}`;
  }

  async synthesize(input: {
    readonly ssml: string;
    readonly voiceId: VoiceId;
  }): Promise<SynthesisResult> {
    const voice = this.voice(input.voiceId);
    const common = {
      Engine: voice.engine,
      VoiceId: voice.name,
      TextType: 'ssml',
      Text: input.ssml,
    } as const;
    const [audioOut, marksOut] = await Promise.all([
      this.send(
        new SynthesizeSpeechCommand({ ...common, OutputFormat: 'mp3', SampleRate: SAMPLE_RATE }),
      ),
      this.send(
        new SynthesizeSpeechCommand({ ...common, OutputFormat: 'json', SpeechMarkTypes: ['ssml'] }),
      ),
    ]);
    const audio = await this.bytes(audioOut);
    const marks = this.parseMarks(new TextDecoder().decode(await this.bytes(marksOut)));
    const durationMs = mp3DurationMs(audio);
    // La facture (observability.md) : caractères facturés des deux requêtes.
    this.logger.log(
      {
        provider: 'polly',
        voiceId: input.voiceId,
        voiceName: voice.name,
        engine: voice.engine,
        characters: (audioOut.RequestCharacters ?? 0) + (marksOut.RequestCharacters ?? 0),
        durationMs,
        ok: true,
      },
      'tts.call',
    );
    return { audio, marks, durationMs };
  }

  onApplicationShutdown(): void {
    // Ferme les sockets keep-alive du SDK : sinon l'arrêt attend leur expiration.
    this.client.destroy?.();
  }

  private voice(voiceId: VoiceId): PollyVoice {
    const voice = POLLY_VOICES.get(voiceId);
    // Le domaine n'accepte que des voix de la liste blanche : une voix sans
    // association est une erreur de configuration, pas une entrée utilisateur.
    if (voice === undefined) throw new TtsRequestRejectedError(`No Polly voice for "${voiceId}"`);
    return voice;
  }

  private async send(command: SynthesizeSpeechCommand): Promise<SynthesizeSpeechCommandOutput> {
    try {
      return await this.client.send(command);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      // Le message d'erreur Polly ne contient pas le texte soumis : loggable.
      // Champs explicites : le code réseau (ECONNRESET, ETIMEDOUT…) et le
      // statut HTTP sont ce qui distingue une panne d'un refus.
      const details = error as {
        message?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      this.logger.error(
        {
          errorName: name,
          message: details.message,
          code: details.code,
          httpStatus: details.$metadata?.httpStatusCode,
        },
        'Polly request failed',
      );
      throw REJECTED_ERRORS.has(name)
        ? new TtsRequestRejectedError(`Polly rejected the request (${name})`, { cause: error })
        : new TtsUnavailableError(`Polly is unavailable (${name})`, { cause: error });
    }
  }

  private async bytes(output: SynthesizeSpeechCommandOutput): Promise<Uint8Array> {
    if (output.AudioStream === undefined) throw new TtsUnavailableError('Empty Polly response');
    return output.AudioStream.transformToByteArray();
  }

  /** Une marque JSON par ligne ; seules les marques `ssml` (nos `w<i>`) nous intéressent. */
  private parseMarks(stream: string): SynthesisMark[] {
    const marks: SynthesisMark[] = [];
    for (const line of stream.split('\n')) {
      if (line.trim() === '') continue;
      const parsed = speechMark.safeParse(parseJsonLine(line));
      if (!parsed.success) throw new TtsUnavailableError('Unexpected Polly speech mark');
      if (parsed.data.type === 'ssml') {
        marks.push({ name: parsed.data.value, timeSeconds: parsed.data.time / 1000 });
      }
    }
    return marks;
  }
}
