import { mp3AudioFrames, mp3DurationMs, SILENT_FRAME_MS, silentMp3 } from './mp3';
import { Mp3AudioAssembler } from './mp3-audio-assembler.adapter';

const ID3V2 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 7, 7, 7]);

function id3v1(): Uint8Array {
  const tag = new Uint8Array(128);
  tag.set([0x54, 0x41, 0x47]); // « TAG »
  return tag;
}

describe('Mp3AudioAssembler', () => {
  it('concatenates frames without re-encoding and reports each chunk duration', () => {
    const a = silentMp3(480);
    const b = silentMp3(240);
    const { audio, durationsMs } = new Mp3AudioAssembler().join([a, b]);
    expect(audio).toHaveLength(a.length + b.length);
    expect(durationsMs).toEqual([480, 240]);
    expect(mp3DurationMs(audio)).toBe(720);
  });

  it('strips ID3 tags so that no metadata ends up in the middle of a part', () => {
    const frames = silentMp3(SILENT_FRAME_MS * 3);
    const tagged = new Uint8Array([...ID3V2, ...frames, ...id3v1()]);
    expect([...mp3AudioFrames(tagged)]).toEqual([...frames]);
    const { audio, durationsMs } = new Mp3AudioAssembler().join([tagged, tagged]);
    expect(audio).toHaveLength(frames.length * 2);
    expect(durationsMs).toEqual([72, 72]);
  });

  it('drops a truncated trailing frame', () => {
    const frames = silentMp3(48);
    expect(mp3AudioFrames(frames.subarray(0, -10))).toHaveLength(96);
  });
});
