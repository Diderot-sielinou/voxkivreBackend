import { Injectable } from '@nestjs/common';

import { DEFAULT_VOICE_ID, type Voice, VOICES } from '../../domain/voices';

export interface VoiceOption extends Voice {
  readonly isDefault: boolean;
}

/** `GET /v1/voices` : voix proposées au choix de l'utilisateur (RF-21). */
@Injectable()
export class ListVoicesUseCase {
  execute(): readonly VoiceOption[] {
    return VOICES.map((voice) => ({ ...voice, isDefault: voice.id === DEFAULT_VOICE_ID }));
  }
}
