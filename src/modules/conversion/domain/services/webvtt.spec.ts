import { buildWebVtt } from './webvtt';

describe('buildWebVtt', () => {
  it('writes one cue per word, identified by its global index, with escaped text', () => {
    const vtt = buildWebVtt([
      { index: 41, text: 'Tom', page: 3, startMs: 0, endMs: 420 },
      { index: 42, text: '<&>', page: 3, startMs: 3_723_004, endMs: 3_723_004 },
    ]);
    expect(vtt).toBe(
      'WEBVTT\n\n' +
        '41\n00:00:00.000 --> 00:00:00.420\nTom\n\n' +
        '42\n01:02:03.004 --> 01:02:03.005\n&lt;&amp;&gt;\n',
    );
  });

  it('is a valid empty file without words', () => {
    expect(buildWebVtt([])).toBe('WEBVTT\n');
  });
});
