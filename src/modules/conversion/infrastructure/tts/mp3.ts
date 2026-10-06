/**
 * Lecture minimale du format MP3 (MPEG audio Layer III), sans dépendance :
 * durée exacte d'un fichier (somme des trames) et génération de silence pour
 * le moteur factice.
 */

const MPEG1 = 3;
const MPEG2 = 2;
const MPEG25 = 0;
const LAYER_III = 1;

// kbit/s, index 1..14 (0 = « free », 15 = invalide).
const BITRATES_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: ReadonlyMap<number, readonly number[]> = new Map([
  [MPEG1, [44_100, 48_000, 32_000]],
  [MPEG2, [22_050, 24_000, 16_000]],
  [MPEG25, [11_025, 12_000, 8000]],
]);

interface FrameHeader {
  readonly length: number;
  readonly samples: number;
  readonly sampleRate: number;
}

function readFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0b11;
  const layer = (b1 >> 1) & 0b11;
  const bitrateIndex = b2 >> 4;
  const sampleRateIndex = (b2 >> 2) & 0b11;
  const padding = (b2 >> 1) & 1;
  const sampleRate = SAMPLE_RATES.get(version)?.at(sampleRateIndex);
  if (layer !== LAYER_III || sampleRate === undefined) return null;
  const table = version === MPEG1 ? BITRATES_MPEG1 : BITRATES_MPEG2;
  const bitrate = table.at(bitrateIndex);
  if (bitrate === undefined || bitrate === 0) return null;
  const coefficient = version === MPEG1 ? 144 : 72;
  return {
    length: Math.floor((coefficient * bitrate * 1000) / sampleRate) + padding,
    samples: version === MPEG1 ? 1152 : 576,
    sampleRate,
  };
}

/** Taille d'une étiquette ID3v2 en tête de fichier (0 s'il n'y en a pas). */
function id3v2Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  // Taille « syncsafe » : 4 × 7 bits.
  return 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
}

/** Durée en millisecondes, arrondie ; s'arrête à la première trame illisible. */
export function mp3DurationMs(bytes: Uint8Array): number {
  let offset = id3v2Size(bytes);
  let seconds = 0;
  for (;;) {
    const header = readFrameHeader(bytes, offset);
    if (header === null) break;
    seconds += header.samples / header.sampleRate;
    offset += header.length;
  }
  return Math.round(seconds * 1000);
}

// MPEG-2 Layer III, 24 kHz, 32 kbit/s, mono, sans CRC : 96 octets, 24 ms par trame.
const SILENT_FRAME_HEADER = [0xff, 0xf3, 0x44, 0xc0];
const SILENT_FRAME_BYTES = 96;
export const SILENT_FRAME_MS = 24;

/**
 * MP3 de silence d'au moins `durationMs` : trames dont les données sont
 * nulles (gain 0), lisibles par tous les lecteurs.
 */
export function silentMp3(durationMs: number): Uint8Array {
  const frames = Math.max(1, Math.ceil(durationMs / SILENT_FRAME_MS));
  const out = new Uint8Array(frames * SILENT_FRAME_BYTES);
  for (let frame = 0; frame < frames; frame += 1) {
    out.set(SILENT_FRAME_HEADER, frame * SILENT_FRAME_BYTES);
  }
  return out;
}
