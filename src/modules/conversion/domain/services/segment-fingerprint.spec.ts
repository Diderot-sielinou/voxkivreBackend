import { cacheKeysFor, segmentFingerprint } from './segment-fingerprint';

describe('segmentFingerprint', () => {
  it('depends on both the engine signature and the SSML', () => {
    const a = segmentFingerprint('google|A', '<speak>x</speak>');
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(segmentFingerprint('google|A', '<speak>x</speak>')).toBe(a);
    expect(segmentFingerprint('google|B', '<speak>x</speak>')).not.toBe(a);
    expect(segmentFingerprint('google|A', '<speak>y</speak>')).not.toBe(a);
    expect(cacheKeysFor(a)).toEqual({ audio: `tts-cache/${a}.mp3`, marks: `tts-cache/${a}.json` });
  });
});
