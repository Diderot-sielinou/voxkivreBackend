import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { HandlePaymentNotificationUseCase } from '@/modules/payment/application/use-cases/handle-payment-notification.use-case';

/**
 * Notifications de Campay (ADR-0021 §3), **sans session** : la signature
 * (JWT HS256) tient lieu d'authentification, puis l'état est relu chez
 * Campay. Corps jamais journalisé (il contient le numéro du client).
 *
 * 200 quand la notification est traitée **ou** ignorée (paiement inconnu) :
 * Campay cesse de la renvoyer. 401 si la signature est invalide, 503 si
 * Campay est injoignable pendant la relecture, pour qu'il réessaie.
 */
@ApiExcludeController()
@Controller({ path: 'webhooks', version: '1' })
export class PaymentWebhooksController {
  constructor(private readonly handleNotification: HandlePaymentNotificationUseCase) {}

  @Post('campay')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Notification traitée ou ignorée' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHORIZED_PAYMENT_NOTIFICATION' })
  @ApiServiceUnavailableResponse({ description: 'INFRASTRUCTURE_PAYMENT_UNAVAILABLE' })
  async campay(@Body() body: unknown): Promise<{ readonly received: true }> {
    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Readonly<Record<string, unknown>>)
        : {};
    const result = await this.handleNotification.execute(payload);
    if (result.isErr()) throw result.error;
    return { received: true };
  }
}
