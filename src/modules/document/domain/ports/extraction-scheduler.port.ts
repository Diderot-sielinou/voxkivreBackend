import { type DocumentId } from '../value-objects/document-id.vo';

export const EXTRACTION_SCHEDULER = Symbol('ExtractionScheduler');

/**
 * Programme l'extraction du texte d'un document (ADR-0009).
 *
 * Contrat : **ne lève jamais**. Si la file est indisponible, l'adapter le
 * logge et renvoie `false` : le document reste `uploaded` et le balayage
 * périodique le reprogrammera. L'upload, déjà réussi, n'est jamais perdu ni
 * signalé en erreur au mobile pour une panne qui ne le concerne pas.
 * Programmer deux fois le même document est sans effet (`jobId` déterministe).
 */
export interface ExtractionSchedulerPort {
  schedule(documentId: DocumentId): Promise<boolean>;
}
