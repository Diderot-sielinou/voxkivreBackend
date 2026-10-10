import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { type AppConfigModule as AppConfigModuleType } from './app-config.module';
import { type Env } from './env.schema';

/** Variables posées pour ce test seulement (Jest : NODE_ENV=test → `.env` ignoré). */
const VARS = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  // Variable présente mais vide : le schéma la rend `undefined`.
  ORANGE_SMS_CLIENT_ID: '',
  ORANGE_SMS_CLIENT_SECRET: '',
};

describe('AppConfigModule', () => {
  const saved = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [key, value] of Object.entries(VARS)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('serves the validated value, never the raw process.env fallback', async () => {
    // Chargé après avoir posé les variables : `forRoot` valide l'env dès
    // l'import (un `import` statique passerait avant `beforeAll`). Jest isole
    // déjà chaque fichier de test : rien d'autre ne l'a chargé ici.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- import différé voulu (cf. ci-dessus)
    const { AppConfigModule } = require('./app-config.module') as {
      AppConfigModule: typeof AppConfigModuleType;
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule] }).compile();
    const config = moduleRef.get<ConfigService<Env, true>>(ConfigService);

    expect(config.get('ORANGE_SMS_CLIENT_ID', { infer: true })).toBeUndefined();
    expect(config.get('ORANGE_SMS_CLIENT_SECRET', { infer: true })).toBeUndefined();
    // Les valeurs par défaut du schéma restent servies.
    expect(config.get('SMS_DAILY_LIMIT', { infer: true })).toBe(300);
  });
});
