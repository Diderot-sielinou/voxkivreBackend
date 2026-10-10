import { Injectable } from '@nestjs/common';

import { SendOtpUseCase } from '@/modules/notification/application/use-cases/send-otp.use-case';

import {
  type OtpDelivery,
  type OtpDeliveryOutcome,
  type OtpSenderPort,
} from '../../domain/ports/otp-sender.port';

/**
 * `OtpSenderPort` branché sur le module notification (ADR-0017) : SMS par
 * Orange, e-mail par SES, plafonds anti-abus. Mode `OTP_DELIVERY_MODE=notification`.
 */
@Injectable()
export class NotificationOtpSender implements OtpSenderPort {
  constructor(private readonly sendOtp: SendOtpUseCase) {}

  send(delivery: OtpDelivery): Promise<OtpDeliveryOutcome> {
    return this.sendOtp.execute(delivery);
  }
}
