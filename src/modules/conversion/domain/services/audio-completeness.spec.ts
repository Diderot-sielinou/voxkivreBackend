import { isAudioComplete } from './audio-completeness';

describe('isAudioComplete', () => {
  it('accepts audio whose last word starts before its end', () => {
    expect(isAudioComplete([{ timeSeconds: 0.1 }, { timeSeconds: 31.445 }], 32_088)).toBe(true);
    expect(isAudioComplete([], 500)).toBe(true);
  });

  it('rejects truncated or empty audio (last word announced after the end)', () => {
    // Cas réel : flux HTTP/2 coupé à 10,92 s, dernier mot annoncé à 35,8 s.
    expect(isAudioComplete([{ timeSeconds: 0.1 }, { timeSeconds: 35.845 }], 10_920)).toBe(false);
    expect(isAudioComplete([{ timeSeconds: 0 }], 0)).toBe(false);
  });
});
