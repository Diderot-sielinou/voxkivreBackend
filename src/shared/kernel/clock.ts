/**
 * Port `Clock` — abstraction de l'horloge système.
 *
 * `domain/` et `application/` ne lisent jamais l'heure via `new Date()` :
 * - tests déterministes (`FakeClock`),
 * - injection par DI sans coupler au runtime Node,
 * - stratégie timezone centralisée (UTC partout).
 *
 * L'implémentation `SystemClock` vit dans `src/shared/clock/` (module Nest) —
 * le kernel reste pur TS.
 */
export interface ClockPort {
  /** Date courante en UTC. */
  now(): Date;
}

/** Token DI (Symbol — jamais string, cf. AGENTS.md). */
export const CLOCK = Symbol('Clock');
