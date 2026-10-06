import { type VoiceId } from '../../domain/voices';

import { FAKE_WORD_DURATION_MS, FakeTtsAdapter } from './fake-tts.adapter';

describe('FakeTtsAdapter', () => {
  it('returns one timepoint per mark and silent MP3 long enough for them', async () => {
    const tts = new FakeTtsAdapter();
    const result = await tts.synthesize({
      ssml: '<speak><mark name="w0"/>Bonjour <mark name="w1"/>monde.</speak>',
      voiceId: 'fr-f1' as VoiceId,
    });
    expect(result.marks).toEqual([
      { name: 'w0', timeSeconds: 0 },
      { name: 'w1', timeSeconds: FAKE_WORD_DURATION_MS / 1000 },
    ]);
    expect(result.durationMs).toBeGreaterThanOrEqual(2 * FAKE_WORD_DURATION_MS);
  });

  it('has its own engine signature, so its silence never pollutes a real engine cache', () => {
    expect(new FakeTtsAdapter().engineSignature('fr-f1' as VoiceId)).toBe('fake-v1|fr-f1|mp3|1.0');
  });
});
