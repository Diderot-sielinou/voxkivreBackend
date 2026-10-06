import { type VoiceId } from '../voices';

export const TTS_ENGINE = Symbol('TtsEngine');

export interface SynthesisMark {
  /** Nom de la marque SSML (`w<i>`). */
  readonly name: string;
  readonly timeSeconds: number;
}

export interface SynthesisResult {
  /** Audio MP3 (ADR-0008). */
  readonly audio: Uint8Array;
  /** Horodatage de chaque marque atteinte (DEC-02 : natif, pas d'alignement forcé). */
  readonly marks: readonly SynthesisMark[];
  readonly durationMs: number;
}

/**
 * Moteur de synthèse vocale (RF-08). Changer de fournisseur = un nouvel
 * adapter (RNF-17). Toujours à la vitesse 1.0 : la vitesse de lecture
 * (RF-22) est appliquée par le lecteur mobile (ADR-0010).
 *
 * Contrat d'erreur : panne transitoire → `TtsUnavailableError` (nouvel
 * essai) ; requête refusée → `TtsRequestRejectedError` (définitif).
 */
export interface TtsPort {
  /**
   * Identifie moteur, voix et réglages audio : entre dans l'empreinte du
   * cache — changer de voix fournisseur ou de format invalide le cache.
   */
  engineSignature(voiceId: VoiceId): string;

  synthesize(input: { readonly ssml: string; readonly voiceId: VoiceId }): Promise<SynthesisResult>;
}
