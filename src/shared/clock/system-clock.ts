import { Injectable } from '@nestjs/common';

import type { ClockPort } from '@/shared/kernel';

/** Implémentation `ClockPort` adossée au runtime Node. */
@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
