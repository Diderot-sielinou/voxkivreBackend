import { type ClockPort } from '@/shared/kernel';

/** Horloge contrôlée par le test (`advance`). */
export class FixedClock implements ClockPort {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
