import { buildProbeTargets, type ProbeTargetsEnv } from './probe-targets';

const EMPTY: ProbeTargetsEnv = {
  DATABASE_URL: undefined,
  DB_HOST: undefined,
  DB_PORT: 5432,
  REDIS_URL: undefined,
  REDIS_HOST: undefined,
  REDIS_PORT: 6379,
};

describe('buildProbeTargets', () => {
  it('marks everything NOT_CONFIGURED when env is empty', () => {
    expect(buildProbeTargets(EMPTY)).toEqual([
      { name: 'postgres', configured: false },
      { name: 'redis', configured: false },
    ]);
  });

  it('uses DB_*/REDIS_* components', () => {
    const targets = buildProbeTargets({
      ...EMPTY,
      DB_HOST: 'localhost',
      DB_PORT: 5433,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6380,
    });
    expect(targets).toEqual([
      { name: 'postgres', configured: true, host: 'localhost', port: 5433 },
      { name: 'redis', configured: true, host: 'localhost', port: 6380 },
    ]);
  });

  it('prefers URLs (Railway) over components and applies default ports', () => {
    const targets = buildProbeTargets({
      ...EMPTY,
      DATABASE_URL: 'postgres://u:p@db.internal:5439/vox',
      DB_HOST: 'ignored',
      REDIS_URL: 'redis://default:pw@redis.internal',
      REDIS_HOST: 'ignored',
    });
    expect(targets).toEqual([
      { name: 'postgres', configured: true, host: 'db.internal', port: 5439 },
      { name: 'redis', configured: true, host: 'redis.internal', port: 6379 },
    ]);
  });

  it('treats an unparsable URL as not configured', () => {
    expect(buildProbeTargets({ ...EMPTY, REDIS_URL: '::not a url::' })[1]).toEqual({
      name: 'redis',
      configured: false,
    });
  });
});
