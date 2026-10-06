import { type ConversionId } from '../value-objects/conversion-id.vo';

export const CONVERSION_JOBS = Symbol('ConversionJobs');

/** Programmation des tâches de la conversion (ADR-0009). Programmer deux fois est sans effet. */
export interface ConversionJobsPort {
  /**
   * Ne lève jamais : file indisponible → `false`, et le balayage périodique
   * reprogrammera la conversion restée `queued` (le statut en base fait foi).
   */
  schedulePreparation(id: ConversionId): Promise<boolean>;

  /**
   * Une tâche par segment ; les premiers segments passent en priorité
   * (aperçu rapide, RF-15). Lève si la file est indisponible (la tâche
   * appelante sera réessayée).
   */
  scheduleSynthesis(id: ConversionId, segmentIndexes: readonly number[]): Promise<void>;
}
