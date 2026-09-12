import { Inject, Injectable } from '@nestjs/common';

import {
  SERVICE_CONNECTIVITY,
  type ServiceConnectivityPort,
} from '@/modules/health/domain/ports/service-connectivity.port';
import { type ProbeConfig } from '@/modules/health/domain/value-objects/probe-config.vo';
import { type ServiceCheck } from '@/modules/health/domain/value-objects/service-check.vo';
import { ServiceHealthReport } from '@/modules/health/domain/value-objects/service-health-report.vo';
import { ServiceStatus } from '@/modules/health/domain/value-objects/service-status.vo';

/** Token DI de la liste des cibles à sonder (construite dans `health.module.ts`). */
export const HEALTH_PROBES = Symbol('HealthProbes');

/**
 * Use-case : sonder toutes les cibles en parallèle et produire un rapport.
 * Ne connaît ni ConfigService, ni TCP, ni HTTP — uniquement des ports et
 * des value objects. C'est ce qui le rend testable en mémoire.
 */
@Injectable()
export class CheckServicesHealthUseCase {
  constructor(
    @Inject(HEALTH_PROBES) private readonly probes: readonly ProbeConfig[],
    @Inject(SERVICE_CONNECTIVITY) private readonly connectivity: ServiceConnectivityPort,
  ) {}

  async execute(): Promise<ServiceHealthReport> {
    const checks = await Promise.all(this.probes.map((config) => this.checkOne(config)));
    return new ServiceHealthReport(checks);
  }

  private async checkOne(config: ProbeConfig): Promise<ServiceCheck> {
    if (!config.configured) {
      return { name: config.name, status: ServiceStatus.NOT_CONFIGURED };
    }
    const result = await this.connectivity.probe(config.host, config.port);
    return {
      name: config.name,
      host: config.host,
      port: config.port,
      status: result.reachable ? ServiceStatus.ACTIVE : ServiceStatus.INACTIVE,
      reason: result.reason,
    };
  }
}
