import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';

import { bootstrapTestApp } from '../support';

import type { INestApplication } from '@nestjs/common';

/**
 * E2E identity sans DB : better-auth ne touche Postgres que s'il a un token
 * de session plausible. Sans en-tête, ou avec un bearer à signature
 * invalide (`requireSignature`), `getSession` renvoie null sans I/O → 401
 * Problem Details. Le flux OTP complet vit dans `better-auth.int.spec.ts`.
 */
describe('identity (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await bootstrapTestApp(moduleFixture);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/me without session → 401 problem+json with code UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .expect(401)
      .expect('content-type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED', instance: '/v1/me' });
  });

  it('GET /v1/me with a forged bearer (bad signature) → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', 'Bearer abcdefghijklmnopqrstuvwxyz012345.forgedsignature')
      .expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('mounts the better-auth handler under /api/auth (unknown sub-route → 404 from better-auth)', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/does-not-exist');
    expect(res.status).toBe(404);
  });
});
