import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '@/modules/identity/interface/http/current-user.decorator';
import {
  type AuthenticatedUser,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';

import { GetBillingAccountUseCase } from '../../application/use-cases/get-billing-account.use-case';
import { ListOffersUseCase } from '../../application/use-cases/list-offers.use-case';
import { ListWalletEntriesUseCase } from '../../application/use-cases/list-wallet-entries.use-case';

import {
  BillingAccountResponseDto,
  OfferListResponseDto,
  WalletEntryListResponseDto,
} from './dto/billing-response.dto';
import { ListWalletEntriesQueryDto } from './dto/list-wallet-entries-query.dto';
import {
  toBillingAccountResponseDto,
  toOfferListResponseDto,
  toWalletEntryListResponseDto,
} from './mappers/billing.mapper';

/**
 * Écran « Abonnement et crédits » (RF-23, ADR-0019) : catalogue, ce qu'il
 * reste dans chaque source, historique du portefeuille. L'achat lui-même
 * passe par le module `payment` (Mobile Money).
 */
@ApiTags('billing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée' })
@Controller({ path: 'billing', version: '1' })
@UseGuards(SessionGuard)
export class BillingController {
  constructor(
    private readonly listOffers: ListOffersUseCase,
    private readonly getAccount: GetBillingAccountUseCase,
    private readonly listWalletEntries: ListWalletEntriesUseCase,
  ) {}

  @Get('offers')
  @ApiOkResponse({ type: OfferListResponseDto })
  async offers(): Promise<OfferListResponseDto> {
    return toOfferListResponseDto(await this.listOffers.execute());
  }

  @Get('account')
  @ApiOkResponse({ type: BillingAccountResponseDto })
  async account(@CurrentUser() user: AuthenticatedUser): Promise<BillingAccountResponseDto> {
    return toBillingAccountResponseDto(await this.getAccount.execute(user.id));
  }

  @Get('wallet/entries')
  @ApiOkResponse({ type: WalletEntryListResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CURSOR' })
  async walletEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWalletEntriesQueryDto,
  ): Promise<WalletEntryListResponseDto> {
    const result = await this.listWalletEntries.execute({
      userId: user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    if (result.isErr()) throw result.error;
    return toWalletEntryListResponseDto(result.value);
  }
}
