import {
  type ServiceConnectivityPort,
  type ServiceConnectivityResult,
} from '@/modules/health/domain/ports/service-connectivity.port';
import { type ProbeConfig } from '@/modules/health/domain/value-objects/probe-config.vo';
import { ServiceStatus } from '@/modules/health/domain/value-objects/service-status.vo';

import { CheckServicesHealthUseCase } from './check-services-health.use-case';

const REDIS_HOST = 'redis.voxlivre.test';
const POSTGRES_HOST = 'postgres.voxlivre.test';

function fakeConnectivity(
  responses: Record<string, ServiceConnectivityResult>,
): ServiceConnectivityPort {
  return {
    probe(host): Promise<ServiceConnectivityResult> {
      return Promise.resolve(responses[host] ?? { reachable: false, reason: 'no fake response' });
    },
  };
}

describe('CheckServicesHealthUseCase', () => {
  it('marks not-configured probes as NOT_CONFIGURED without calling connectivity', async () => {
    const probe = jest.fn();
    const sut = new CheckServicesHealthUseCase([{ name: 'redis', configured: false }], { probe });

    const report = await sut.execute();

    expect(report.checks).toEqual([{ name: 'redis', status: ServiceStatus.NOT_CONFIGURED }]);
    expect(report.healthy).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('marks reachable probes as ACTIVE', async () => {
    const probes: readonly ProbeConfig[] = [
      { name: 'redis', configured: true, host: REDIS_HOST, port: 6379 },
    ];
    const sut = new CheckServicesHealthUseCase(
      probes,
      fakeConnectivity({ [REDIS_HOST]: { reachable: true } }),
    );

    const report = await sut.execute();

    expect(report.checks).toEqual([
      {
        name: 'redis',
        host: REDIS_HOST,
        port: 6379,
        status: ServiceStatus.ACTIVE,
        reason: undefined,
      },
    ]);
    expect(report.healthy).toBe(true);
  });

  it('marks unreachable probes as INACTIVE, propagates the reason, and reports unhealthy', async () => {
    const probes: readonly ProbeConfig[] = [
      { name: 'postgres', configured: true, host: POSTGRES_HOST, port: 5432 },
    ];
    const sut = new CheckServicesHealthUseCase(
      probes,
      fakeConnectivity({ [POSTGRES_HOST]: { reachable: false, reason: 'ECONNREFUSED' } }),
    );

    const report = await sut.execute();

    expect(report.checks[0]).toMatchObject({
      status: ServiceStatus.INACTIVE,
      reason: 'ECONNREFUSED',
    });
    expect(report.healthy).toBe(false);
  });

  it('handles a mix of configured and unconfigured probes', async () => {
    const probes: readonly ProbeConfig[] = [
      { name: 'redis', configured: true, host: REDIS_HOST, port: 6379 },
      { name: 'postgres', configured: false },
    ];
    const sut = new CheckServicesHealthUseCase(
      probes,
      fakeConnectivity({ [REDIS_HOST]: { reachable: true } }),
    );

    const report = await sut.execute();

    expect(report.checks.map((c) => c.status)).toEqual([
      ServiceStatus.ACTIVE,
      ServiceStatus.NOT_CONFIGURED,
    ]);
  });
});
