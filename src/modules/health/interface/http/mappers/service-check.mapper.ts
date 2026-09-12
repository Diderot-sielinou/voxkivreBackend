import { type ServiceCheck } from '@/modules/health/domain/value-objects/service-check.vo';
import { type ServiceHealthReport } from '@/modules/health/domain/value-objects/service-health-report.vo';
import {
  type ServicesHealthItemDto,
  type ServicesHealthResponseDto,
} from '@/modules/health/interface/http/dto/services-health-response.dto';

/**
 * Mapper domain → DTO. Explicite même quand les champs coïncident : le jour
 * où le domain change (ex. `latencyMs` interne), le contrat HTTP ne bouge
 * pas par accident.
 */
export function toServicesHealthItemDto(check: ServiceCheck): ServicesHealthItemDto {
  return {
    name: check.name,
    status: check.status,
    host: check.host,
    port: check.port,
    reason: check.reason,
  };
}

export function toServicesHealthResponseDto(
  report: ServiceHealthReport,
): ServicesHealthResponseDto {
  return {
    healthy: report.healthy,
    services: report.checks.map((check) => toServicesHealthItemDto(check)),
  };
}
