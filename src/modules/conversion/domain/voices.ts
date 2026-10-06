import { type Brand } from '@/shared/kernel';

/**
 * Identifiant de voix **propre à Voxlivre** : le mobile ne connaît jamais le
 * nom de voix du fournisseur (changer de moteur = un nouvel adapter, RNF-17).
 */
export type VoiceId = Brand<string, 'VoiceId'>;

export interface Voice {
  readonly id: VoiceId;
  readonly label: string;
  readonly gender: 'female' | 'male';
  readonly languageCode: 'fr-FR';
}

/**
 * Voix proposées (RF-21) : liste blanche, fr-FR. Chaque adapter TTS associe
 * ces identifiants à ses propres voix (WaveNet pour Google, ADR-0008).
 */
export const VOICES: readonly Voice[] = [
  { id: 'fr-f1' as VoiceId, label: 'Voix féminine 1', gender: 'female', languageCode: 'fr-FR' },
  { id: 'fr-m1' as VoiceId, label: 'Voix masculine 1', gender: 'male', languageCode: 'fr-FR' },
  { id: 'fr-f2' as VoiceId, label: 'Voix féminine 2', gender: 'female', languageCode: 'fr-FR' },
  { id: 'fr-m2' as VoiceId, label: 'Voix masculine 2', gender: 'male', languageCode: 'fr-FR' },
];

export const DEFAULT_VOICE_ID = 'fr-f1' as VoiceId;

/** La voix si elle est dans la liste blanche, sinon `null`. */
export function findVoice(raw: string): Voice | null {
  return VOICES.find((voice) => voice.id === raw) ?? null;
}
