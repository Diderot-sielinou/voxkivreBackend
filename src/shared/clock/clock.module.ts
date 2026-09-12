import { Global, Module } from '@nestjs/common';

import { CLOCK } from '@/shared/kernel';

import { SystemClock } from './system-clock';

/**
 * Expose le port `CLOCK` partout (`@Global()`) : use-cases, jobs, quotas
 * mensuels, expiration d'OTP. Aucun module n'a à l'importer explicitement.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
