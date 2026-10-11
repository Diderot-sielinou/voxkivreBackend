import { type CursorPage } from '@/shared/kernel';

import { type BillingAccount } from '../../../application/use-cases/get-billing-account.use-case';
import { type OfferCatalog } from '../../../application/use-cases/list-offers.use-case';
import { type WalletEntry } from '../../../domain/ports/wallet-history.port';
import {
  type BillingAccountResponseDto,
  type OfferListResponseDto,
  type WalletEntryListResponseDto,
} from '../dto/billing-response.dto';

export function toOfferListResponseDto(catalog: OfferCatalog): OfferListResponseDto {
  return {
    items: catalog.offers.map((offer) => ({
      code: offer.code,
      kind: offer.kind,
      priceXaf: offer.price,
      units: offer.units,
      durationDays: offer.kind === 'pass' ? offer.durationDays : null,
    })),
    voiceTierWeights: { ...catalog.voiceTierWeights },
  };
}

export function toBillingAccountResponseDto(account: BillingAccount): BillingAccountResponseDto {
  return {
    period: account.period,
    free: { ...account.free },
    pass:
      account.pass === null
        ? null
        : {
            endsAt: account.pass.endsAt.toISOString(),
            includedUnits: account.pass.includedUnits,
            usedUnits: account.pass.usedUnits,
            remainingUnits: account.pass.remainingUnits,
          },
    nextPassStartsAt: account.nextPassStartsAt?.toISOString() ?? null,
    credits: account.credits,
    maxCharsPerConversion: account.maxCharsPerConversion,
  };
}

/** `reservationId` est l'identifiant de la conversion : exposé sous ce nom. */
export function toWalletEntryListResponseDto(
  page: CursorPage<WalletEntry>,
): WalletEntryListResponseDto {
  return {
    items: page.items.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      units: entry.units,
      createdAt: entry.createdAt.toISOString(),
      offerCode: entry.offerCode,
      conversionId: entry.reservationId,
    })),
    nextCursor: page.nextCursor,
  };
}
