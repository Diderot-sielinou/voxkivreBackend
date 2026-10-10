import { createCursorCodec } from '@/shared/kernel';

import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryBilling,
} from '../../../../../test/support/fakes';

import { GrantOfferUseCase } from './grant-offer.use-case';
import { ListOffersUseCase } from './list-offers.use-case';
import { ListWalletEntriesUseCase } from './list-wallet-entries.use-case';

describe('ListWalletEntriesUseCase / ListOffersUseCase', () => {
  const cursors = createCursorCodec<string>('w'.repeat(32));

  it('pages the wallet history from the most recent entry', async () => {
    const billing = new InMemoryBilling();
    const clock = new FixedClock(new Date('2026-10-10T12:00:00Z'));
    const grant = new GrantOfferUseCase(billing, billing, new ImmediateUnitOfWork(), clock);
    for (const [i, code] of ['credits-s', 'credits-m', 'credits-l'].entries()) {
      await grant.execute({
        userId: 'alice',
        offerCode: code,
        paymentReference: `pay-${String(i)}`,
      });
      clock.advance(1000);
    }
    const list = new ListWalletEntriesUseCase(billing, cursors);

    const first = await list.execute({ userId: 'alice', limit: 2 });
    expect(first.value.items.map((e) => e.offerCode)).toEqual(['credits-l', 'credits-m']);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await list.execute({
      userId: 'alice',
      limit: 2,
      cursor: first.value.nextCursor ?? undefined,
    });
    expect(second.value.items.map((e) => e.offerCode)).toEqual(['credits-s']);
    expect(second.value.nextCursor).toBeNull();
    const empty = await list.execute({ userId: 'bob' });
    expect(empty.value.items).toEqual([]);
  });

  it('rejects a tampered cursor', async () => {
    const list = new ListWalletEntriesUseCase(new InMemoryBilling(), cursors);
    const result = await list.execute({ userId: 'alice', cursor: 'abc.def' });
    expect(result.error.code).toBe('INVALID_CURSOR');
  });

  it('lists the offers on sale with the voice weights', async () => {
    const catalog = await new ListOffersUseCase(new InMemoryBilling()).execute();
    expect(catalog.offers.map((o) => o.code)).toEqual([
      'pass-30d',
      'credits-s',
      'credits-m',
      'credits-l',
    ]);
    expect(catalog.voiceTierWeights).toEqual({ standard: 1, natural: 4 });
  });
});
