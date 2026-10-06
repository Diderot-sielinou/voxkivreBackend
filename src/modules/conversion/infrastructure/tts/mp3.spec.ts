import { mp3DurationMs, SILENT_FRAME_MS, silentMp3 } from './mp3';

describe('mp3', () => {
  it('generates silence of at least the requested duration, and measures it frame by frame', () => {
    const audio = silentMp3(1000);
    const frames = Math.ceil(1000 / SILENT_FRAME_MS);
    expect(audio).toHaveLength(frames * 96);
    expect(mp3DurationMs(audio)).toBe(frames * SILENT_FRAME_MS);
    expect(mp3DurationMs(silentMp3(0))).toBe(SILENT_FRAME_MS);
  });

  it('skips a leading ID3v2 tag and stops at the first unreadable frame', () => {
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    const audio = silentMp3(48);
    const withTag = new Uint8Array([...tag, ...audio, 0x00, 0x11]);
    expect(mp3DurationMs(withTag)).toBe(48);
  });

  it('reads MPEG-1 frames (44.1 kHz) as produced by other encoders', () => {
    // MPEG-1 Layer III, 128 kbit/s, 44,1 kHz : 417 octets, 1 152 échantillons.
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    expect(mp3DurationMs(new Uint8Array([...frame, ...frame]))).toBe(
      Math.round((2 * 1152 * 1000) / 44_100),
    );
  });

  it('returns 0 for anything that is not MP3', () => {
    expect(mp3DurationMs(new TextEncoder().encode('not audio'))).toBe(0);
    expect(mp3DurationMs(new Uint8Array([0xff, 0xf3, 0xf4, 0xc0]))).toBe(0); // débit invalide
  });
});
