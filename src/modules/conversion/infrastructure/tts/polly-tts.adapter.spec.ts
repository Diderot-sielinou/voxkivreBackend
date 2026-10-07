import {
  type SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandOutput,
} from '@aws-sdk/client-polly';
import { Logger } from '@nestjs/common';

import { TtsRequestRejectedError, TtsUnavailableError } from '../../domain/errors/tts.errors';
import { type VoiceId } from '../../domain/voices';

import { silentMp3 } from './mp3';
import { type PollySender, PollyTtsAdapter } from './polly-tts.adapter';

const SSML = '<speak><mark name="w0"/>Bonjour <mark name="w1"/>monde.</speak>';
const VOICE = 'fr-f1' as VoiceId;

function output(body: Uint8Array | string, requestCharacters = 14): SynthesizeSpeechCommandOutput {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    AudioStream: { transformToByteArray: () => Promise.resolve(bytes) },
    RequestCharacters: requestCharacters,
    $metadata: {},
  } as unknown as SynthesizeSpeechCommandOutput;
}

const MARKS =
  '{"time":6,"type":"ssml","start":7,"end":24,"value":"w0"}\n' +
  '{"time":412,"type":"ssml","start":32,"end":49,"value":"w1"}\n';

/** Faux Polly : enregistre les requêtes et renvoie l'audio ou les marques selon le format demandé. */
function fakePolly(overrides: { marks?: string; fail?: Error } = {}) {
  const inputs: SynthesizeSpeechCommand['input'][] = [];
  let destroyed = false;
  const client: PollySender = {
    send: ((command: SynthesizeSpeechCommand) => {
      inputs.push(command.input);
      if (overrides.fail !== undefined) return Promise.reject(overrides.fail);
      return Promise.resolve(
        command.input.OutputFormat === 'mp3'
          ? output(silentMp3(480))
          : output(overrides.marks ?? MARKS),
      );
    }) as PollySender['send'],
    destroy: () => {
      destroyed = true;
    },
  };
  return { client, inputs, isDestroyed: () => destroyed };
}

function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('PollyTtsAdapter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the audio and the SSML speech marks requests, and maps the result', async () => {
    const { client, inputs } = fakePolly();
    const result = await new PollyTtsAdapter(client).synthesize({ ssml: SSML, voiceId: VOICE });

    expect(inputs).toEqual([
      {
        Engine: 'neural',
        VoiceId: 'Lea',
        TextType: 'ssml',
        Text: SSML,
        OutputFormat: 'mp3',
        SampleRate: '24000',
      },
      {
        Engine: 'neural',
        VoiceId: 'Lea',
        TextType: 'ssml',
        Text: SSML,
        OutputFormat: 'json',
        SpeechMarkTypes: ['ssml'],
      },
    ]);
    expect(result.marks).toEqual([
      { name: 'w0', timeSeconds: 0.006 },
      { name: 'w1', timeSeconds: 0.412 },
    ]);
    expect(result.durationMs).toBe(480);
  });

  it('maps every Voxlivre voice to a Polly voice and engine, and signs the cache with them', async () => {
    const { client, inputs } = fakePolly();
    const tts = new PollyTtsAdapter(client);
    expect(tts.engineSignature('fr-f1' as VoiceId)).toBe('polly|neural|Lea|mp3|24000');
    expect(tts.engineSignature('fr-m1' as VoiceId)).toBe('polly|neural|Remi|mp3|24000');
    expect(tts.engineSignature('fr-f2' as VoiceId)).toBe('polly|standard|Celine|mp3|24000');
    await tts.synthesize({ ssml: SSML, voiceId: 'fr-m2' as VoiceId });
    expect(inputs[0]).toMatchObject({ Engine: 'standard', VoiceId: 'Mathieu' });
    await expect(tts.synthesize({ ssml: SSML, voiceId: 'xx' as VoiceId })).rejects.toBeInstanceOf(
      TtsRequestRejectedError,
    );
  });

  it('logs the billed characters of both requests (the invoice)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { client } = fakePolly();
    await new PollyTtsAdapter(client).synthesize({ ssml: SSML, voiceId: VOICE });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'polly',
        voiceName: 'Lea',
        engine: 'neural',
        characters: 28,
        ok: true,
      }),
      'tts.call',
    );
  });

  it.each([
    ['InvalidSsmlException', TtsRequestRejectedError],
    ['TextLengthExceededException', TtsRequestRejectedError],
    ['EngineNotSupportedException', TtsRequestRejectedError],
    ['ThrottlingException', TtsUnavailableError],
    ['ServiceFailureException', TtsUnavailableError],
    ['CredentialsProviderError', TtsUnavailableError],
  ])('maps %s to %p', async (name, expected) => {
    const { client } = fakePolly({ fail: named(name) });
    await expect(
      new PollyTtsAdapter(client).synthesize({ ssml: SSML, voiceId: VOICE }),
    ).rejects.toBeInstanceOf(expected);
  });

  it('ignores non-SSML marks, and treats a malformed mark stream or an empty body as an outage', async () => {
    const mixed = fakePolly({
      marks: '{"time":0,"type":"sentence","value":"Bonjour monde."}\n' + MARKS,
    });
    const result = await new PollyTtsAdapter(mixed.client).synthesize({
      ssml: SSML,
      voiceId: VOICE,
    });
    expect(result.marks.map((m) => m.name)).toEqual(['w0', 'w1']);

    const broken = fakePolly({ marks: 'not json\n' });
    await expect(
      new PollyTtsAdapter(broken.client).synthesize({ ssml: SSML, voiceId: VOICE }),
    ).rejects.toBeInstanceOf(TtsUnavailableError);

    const empty: PollySender = {
      send: () => Promise.resolve({ $metadata: {} }),
    };
    await expect(
      new PollyTtsAdapter(empty).synthesize({ ssml: SSML, voiceId: VOICE }),
    ).rejects.toBeInstanceOf(TtsUnavailableError);
  });

  it('closes the SDK client on shutdown', () => {
    const { client, isDestroyed } = fakePolly();
    new PollyTtsAdapter(client).onApplicationShutdown();
    expect(isDestroyed()).toBe(true);
  });
});
