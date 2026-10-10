import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import {
  OTP_DISPATCH_LOG,
  type OtpDispatchLogPort,
} from '../../domain/ports/otp-dispatch-log.port';

/** Le journal ne sert qu'aux plafonds (1 h, 1 jour) : 2 jours suffisent. */
export const OTP_DISPATCH_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** Purge du journal des envois (ADR-0017 §4) : rien n'est gardé au-delà du besoin. */
@Injectable()
export class PurgeOtpDispatchesUseCase {
  constructor(
    @Inject(OTP_DISPATCH_LOG) private readonly log: OtpDispatchLogPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  execute(): Promise<number> {
    return this.log.purgeBefore(new Date(this.clock.now().getTime() - OTP_DISPATCH_RETENTION_MS));
  }
}
