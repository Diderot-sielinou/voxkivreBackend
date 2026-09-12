import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ServiceStatus } from '@/modules/health/domain/value-objects/service-status.vo';

export class ServicesHealthItemDto {
  @ApiProperty({ example: 'postgres' })
  name!: string;

  @ApiProperty({ enum: Object.values(ServiceStatus), example: ServiceStatus.ACTIVE })
  status!: ServiceStatus;

  @ApiPropertyOptional({ example: 'localhost' })
  host?: string;

  @ApiPropertyOptional({ example: 5432 })
  port?: number;

  @ApiPropertyOptional({ example: 'ECONNREFUSED', description: 'Présent si INACTIVE' })
  reason?: string;
}

export class ServicesHealthResponseDto {
  @ApiProperty({ example: true })
  healthy!: boolean;

  @ApiProperty({ type: [ServicesHealthItemDto] })
  services!: ServicesHealthItemDto[];
}

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';
}
