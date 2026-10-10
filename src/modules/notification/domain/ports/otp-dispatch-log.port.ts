import { type OtpChannel } from '../otp-dispatch';

export const OTP_DISPATCH_LOG = Symbol('OtpDispatchLog');

/**
 * Journal des envois (ADR-0017) pour les plafonds. La destination n'y est
 * jamais en clair : `destinationKey` est une empreinte (`DestinationHasherPort`).
 */
export interface OtpDispatchLogPort {
  record(channel: OtpChannel, destinationKey: string, at: Date): Promise<void>;

  countForDestinationSince(destinationKey: string, since: Date): Promise<number>;

  countForChannelSince(channel: OtpChannel, since: Date): Promise<number>;

  /** Supprime les lignes plus anciennes que `before` ; renvoie leur nombre. */
  purgeBefore(before: Date): Promise<number>;
}
