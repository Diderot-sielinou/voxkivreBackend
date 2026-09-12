import { type ServiceCheck } from './service-check.vo';
import { ServiceStatus } from './service-status.vo';

/** Rapport agrégé. `healthy` = aucun service configuré n'est INACTIVE. */
export class ServiceHealthReport {
  constructor(public readonly checks: readonly ServiceCheck[]) {}

  get healthy(): boolean {
    return this.checks.every((c) => c.status !== ServiceStatus.INACTIVE);
  }
}
