import { ServiceHealthReport } from '@/modules/health/domain/value-objects/service-health-report.vo';
import { ServiceStatus } from '@/modules/health/domain/value-objects/service-status.vo';

import { toServicesHealthItemDto, toServicesHealthResponseDto } from './service-check.mapper';

describe('service-check.mapper', () => {
  it('renders an INACTIVE check with reason', () => {
    expect(
      toServicesHealthItemDto({
        name: 'postgres',
        status: ServiceStatus.INACTIVE,
        host: 'db',
        port: 5432,
        reason: 'ECONNREFUSED',
      }),
    ).toEqual({
      name: 'postgres',
      status: 'INACTIVE',
      host: 'db',
      port: 5432,
      reason: 'ECONNREFUSED',
    });
  });

  it('renders a NOT_CONFIGURED check without host/port/reason', () => {
    expect(
      toServicesHealthItemDto({ name: 'redis', status: ServiceStatus.NOT_CONFIGURED }),
    ).toEqual({
      name: 'redis',
      status: 'NOT_CONFIGURED',
      host: undefined,
      port: undefined,
      reason: undefined,
    });
  });

  it('renders the aggregated report', () => {
    const report = new ServiceHealthReport([
      { name: 'redis', status: ServiceStatus.ACTIVE, host: 'r', port: 1 },
    ]);
    const dto = toServicesHealthResponseDto(report);
    expect(dto.healthy).toBe(true);
    expect(dto.services).toHaveLength(1);
  });
});
