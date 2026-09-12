import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import {
  CheckServicesHealthUseCase,
  HEALTH_PROBES,
} from '@/modules/health/application/use-cases/check-services-health.use-case';
import {
  SERVICE_CONNECTIVITY,
  type ServiceConnectivityPort,
} from '@/modules/health/domain/ports/service-connectivity.port';
import { type ProbeConfig } from '@/modules/health/domain/value-objects/probe-config.vo';

import { bootstrapTestApp } from '../support';

import type { INestApplication } from '@nestjs/common';

const REDIS_HOST = 'redis.voxlivre.test';
const POSTGRES_HOST = 'postgres.voxlivre.test';

/**
 * E2E : l'AppModule COMPLET est monté, mais les ports du module health sont
 * overridés par des fakes. Aucun réseau réel : Drizzle et Redis sont lazy,
 * la sonde est simulée. On teste le wiring HTTP → use-case → DTO, le format
 * d'erreur RFC 7807 et le rate-limit — pas la connectivité.
 */
describe('health (e2e)', () => {
  let app: INestApplication;
  let reachable: Record<string, boolean>;

  const probes: readonly ProbeConfig[] = [
    { name: 'postgres', configured: true, host: POSTGRES_HOST, port: 5432 },
    { name: 'redis', configured: true, host: REDIS_HOST, port: 6379 },
  ];

  const fakeConnectivity: ServiceConnectivityPort = {
    probe(host) {
      return Promise.resolve(
        reachable[host] ? { reachable: true } : { reachable: false, reason: 'ECONNREFUSED' },
      );
    },
  };

  beforeEach(async () => {
    reachable = { [POSTGRES_HOST]: true, [REDIS_HOST]: true };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HEALTH_PROBES)
      .useValue(probes)
      .overrideProvider(SERVICE_CONNECTIVITY)
      .useValue(fakeConnectivity)
      .compile();

    app = await bootstrapTestApp(moduleFixture);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health → 200 { status: ok } (version-neutral, no /v1 prefix)', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('GET /health/services → 200 when every service is reachable', async () => {
    const res = await request(app.getHttpServer()).get('/health/services').expect(200);
    expect(res.body).toEqual({
      healthy: true,
      services: [
        { name: 'postgres', status: 'ACTIVE', host: POSTGRES_HOST, port: 5432 },
        { name: 'redis', status: 'ACTIVE', host: REDIS_HOST, port: 6379 },
      ],
    });
  });

  it('GET /health/services → 503 with details when a service is down', async () => {
    reachable[REDIS_HOST] = false;
    const res = await request(app.getHttpServer()).get('/health/services').expect(503);
    expect(res.body.healthy).toBe(false);
    expect(res.body.services[1]).toEqual({
      name: 'redis',
      status: 'INACTIVE',
      host: REDIS_HOST,
      port: 6379,
      reason: 'ECONNREFUSED',
    });
  });

  it('echoes x-request-id and returns RFC 7807 on unknown route', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/does-not-exist')
      .set('x-request-id', 'trace-abc')
      .expect(404)
      .expect('content-type', /application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('trace-abc');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/v1/does-not-exist',
      requestId: 'trace-abc',
    });
  });

  it('rate-limits a matched route: exactly RATE_LIMIT_MAX hits pass, then 429 problem', async () => {
    // Défaut RATE_LIMIT_MAX = 10, store in-memory (pas de REDIS_* en test :
    // `.env` est ignoré hors development, le compteur est propre à cette app).
    const limit = 10;
    for (let i = 0; i < limit; i += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }

    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(429)
      .expect('content-type', /application\/problem\+json/);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
  });

  it('exposes the use-case through DI (sanity check of the module wiring)', () => {
    expect(app.get(CheckServicesHealthUseCase)).toBeInstanceOf(CheckServicesHealthUseCase);
  });
});
