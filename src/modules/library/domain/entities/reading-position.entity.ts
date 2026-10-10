/**
 * Position de lecture d'une conversion (RF-19, ADR-0015) : le mot (index
 * global, celui du WebVTT) et l'instant audio où l'utilisateur s'est
 * arrêté. Une ligne par conversion ; `recordedAt` = instant de
 * l'interruption sur l'appareil (pas de l'envoi) : il départage deux
 * appareils.
 */
export interface ReadingPosition {
  readonly conversionId: string;
  readonly ownerId: string;
  readonly wordIndex: number;
  readonly audioMs: number;
  readonly recordedAt: Date;
  readonly updatedAt: Date;
}
