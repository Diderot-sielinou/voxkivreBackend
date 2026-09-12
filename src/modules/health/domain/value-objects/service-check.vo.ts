import { type ServiceStatus } from './service-status.vo';

/** Résultat de la sonde d'un service. */
export interface ServiceCheck {
  readonly name: string;
  readonly status: ServiceStatus;
  readonly host?: string;
  readonly port?: number;
  readonly reason?: string;
}
