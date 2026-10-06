import { Injectable } from '@nestjs/common';

import {
  type SynthesisMark,
  type SynthesisResult,
  type TtsPort,
} from '../../domain/ports/tts.port';
import { type VoiceId } from '../../domain/voices';

import { mp3DurationMs, silentMp3 } from './mp3';

/** Rythme simulé : ~170 mots par minute, celui d'une lecture à voix haute. */
export const FAKE_WORD_DURATION_MS = 350;

const MARK = /<mark name="([^"]+)"\/>/gu;

/**
 * Moteur factice (dev, CI, tests) : MP3 de silence et horodatages calculés,
 * une marque toutes les {@link FAKE_WORD_DURATION_MS}. Tout le pipeline
 * tourne sans payer Google ; la signature distincte empêche ses sorties de
 * se mélanger au cache d'un vrai moteur.
 */
@Injectable()
export class FakeTtsAdapter implements TtsPort {
  engineSignature(voiceId: VoiceId): string {
    return `fake-v1|${voiceId}|mp3|1.0`;
  }

  synthesize(input: {
    readonly ssml: string;
    readonly voiceId: VoiceId;
  }): Promise<SynthesisResult> {
    const marks: SynthesisMark[] = [...input.ssml.matchAll(MARK)].map((match, i) => ({
      name: match[1],
      timeSeconds: (i * FAKE_WORD_DURATION_MS) / 1000,
    }));
    const audio = silentMp3(marks.length * FAKE_WORD_DURATION_MS);
    return Promise.resolve({ audio, marks, durationMs: mp3DurationMs(audio) });
  }
}
