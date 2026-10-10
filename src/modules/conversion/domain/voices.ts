import { type Brand } from '@/shared/kernel';

/**
 * Identifiant de voix **propre à Voxlivre** : le mobile ne connaît jamais le
 * nom de voix du fournisseur (changer de moteur = un nouvel adapter, RNF-17).
 */
export type VoiceId = Brand<string, 'VoiceId'>;

/**
 * Gamme d'une voix : `natural` (neuronale) coûte 4 fois plus cher que
 * `standard` ; le quota la pondère et le palier gratuit ne finance que les
 * voix standard (ADR-0019).
 */
export type VoiceTier = 'standard' | 'natural';

export interface Voice {
  readonly id: VoiceId;
  readonly label: string;
  readonly gender: 'female' | 'male';
  readonly languageCode: 'fr-FR';
  readonly tier: VoiceTier;
}

/**
 * Voix proposées (RF-21) : liste blanche, fr-FR. « Naturelle » = voix
 * neuronale (4 fois plus chère), « standard » = voix classique. Chaque adapter
 * TTS associe ces identifiants à ses propres voix (Polly, ADR-0013).
 */
export const VOICES: readonly Voice[] = [
  {
    id: 'fr-f1' as VoiceId,
    label: 'Voix féminine naturelle',
    gender: 'female',
    languageCode: 'fr-FR',
    tier: 'natural',
  },
  {
    id: 'fr-m1' as VoiceId,
    label: 'Voix masculine naturelle',
    gender: 'male',
    languageCode: 'fr-FR',
    tier: 'natural',
  },
  {
    id: 'fr-f2' as VoiceId,
    label: 'Voix féminine standard',
    gender: 'female',
    languageCode: 'fr-FR',
    tier: 'standard',
  },
  {
    id: 'fr-m2' as VoiceId,
    label: 'Voix masculine standard',
    gender: 'male',
    languageCode: 'fr-FR',
    tier: 'standard',
  },
];

/**
 * Voix par défaut : **standard**, la seule gamme que finance le palier
 * gratuit (ADR-0019) — un nouvel utilisateur peut convertir sans payer.
 */
export const DEFAULT_VOICE_ID = 'fr-f2' as VoiceId;

/** La voix si elle est dans la liste blanche, sinon `null`. */
export function findVoice(raw: string): Voice | null {
  return VOICES.find((voice) => voice.id === raw) ?? null;
}
