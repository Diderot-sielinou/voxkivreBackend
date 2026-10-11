import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { GetPaymentUseCase } from '@/modules/payment/application/use-cases/get-payment.use-case';
import { InitiatePaymentUseCase } from '@/modules/payment/application/use-cases/initiate-payment.use-case';

import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { toPaymentResponseDto } from './mappers/payment.mapper';

/**
 * Paiement d'une offre par Mobile Money (RF-23, ADR-0021) : la demande part
 * sur le téléphone du client, qui la confirme par son code ; le mobile suit
 * ensuite `status` (polling) jusqu'à `succeeded`.
 */
@ApiTags('payments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'payments', version: '1' })
@UseGuards(SessionGuard)
export class PaymentsController {
  constructor(
    private readonly initiatePayment: InitiatePaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Une clé par achat (UUID conseillé) : un renvoi ne redemande pas le paiement',
  })
  @ApiAcceptedResponse({
    type: PaymentResponseDto,
    description: 'Demande envoyée au téléphone (ou paiement déjà créé avec cette clé)',
  })
  @ApiNotFoundResponse({ description: 'OFFER_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'PAYMENT_IN_PROGRESS_CONFLICT (details.paymentId) | PAYMENT_IDEMPOTENCY_CONFLICT',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_PAYMENT_PHONE | INVALID_IDEMPOTENCY_KEY',
  })
  @ApiTooManyRequestsResponse({ description: 'RATE_LIMIT_PAYMENT_ATTEMPTS (details.reason)' })
  @ApiServiceUnavailableResponse({
    description: 'INFRASTRUCTURE_PAYMENT_UNAVAILABLE : réessayer avec la même Idempotency-Key',
  })
  async initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: InitiatePaymentDto,
  ): Promise<PaymentResponseDto> {
    const result = await this.initiatePayment.execute({
      userId: user.id,
      offerCode: body.offerCode,
      phoneNumber: body.phoneNumber,
      // Absente → refusée par `IdempotencyKey.of` (INVALID_IDEMPOTENCY_KEY).
      idempotencyKey: idempotencyKey ?? '',
    });
    if (result.isErr()) throw result.error;
    return toPaymentResponseDto(result.value);
  }

  @Get(':id')
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ description: 'PAYMENT_NOT_FOUND' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentResponseDto> {
    const result = await this.getPayment.execute(id, user.id);
    if (result.isErr()) throw result.error;
    return toPaymentResponseDto(result.value);
  }
}
