export const AUDIO_ASSEMBLER = Symbol('AudioAssembler');

export interface AssembledAudio {
  readonly audio: Uint8Array;
  /** Durée réelle de chaque morceau dans le fichier assemblé, dans l'ordre. */
  readonly durationsMs: readonly number[];
}

/**
 * Met bout à bout des morceaux audio du même format, sans réencodage
 * (DEC-01 : pas de FFmpeg). Les durées renvoyées servent à décaler les
 * horodatages : elles doivent correspondre exactement à ce que joue le
 * lecteur (ADR-0011).
 */
export interface AudioAssemblerPort {
  join(chunks: readonly Uint8Array[]): AssembledAudio;
}
