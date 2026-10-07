import { Injectable } from '@nestjs/common';

import {
  type AssembledAudio,
  type AudioAssemblerPort,
} from '../../domain/ports/audio-assembler.port';

import { mp3AudioFrames, mp3DurationMs } from './mp3';

/**
 * Concaténation MP3 sans réencodage (DEC-01, ADR-0011) : chaque morceau est
 * réduit à ses trames audio (étiquettes ID3 retirées), puis les trames sont
 * mises bout à bout. La durée de chaque morceau est celle de ses trames :
 * exactement ce que joue le lecteur, donc des décalages d'horodatage justes.
 */
@Injectable()
export class Mp3AudioAssembler implements AudioAssemblerPort {
  join(chunks: readonly Uint8Array[]): AssembledAudio {
    const frames = chunks.map((chunk) => mp3AudioFrames(chunk));
    const audio = new Uint8Array(frames.reduce((sum, f) => sum + f.length, 0));
    let offset = 0;
    for (const f of frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    return { audio, durationsMs: frames.map((f) => mp3DurationMs(f)) };
  }
}
