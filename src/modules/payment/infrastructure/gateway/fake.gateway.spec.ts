import { MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';

import { DisabledGateway } from './disabled.gateway';
import { FakeGateway, signFakeNotification } from './fake.gateway';

const request = (phone: string) => ({
  externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
  amountXaf: 500,
  phone: MobileMoneyNumber.of(phone).value,
  description: 'Voxlivre - Credits 50000 unites',
});

describe('FakeGateway', () => {
  it('accepts the request and confirms it on the next read, with the same reference', async () => {
    const gateway = new FakeGateway();
    const first = await gateway.collect(request('+237699000012'));
    const again = await gateway.collect(request('+237699000012'));
    expect(again.value.reference).toBe(first.value.reference);

    const transaction = await gateway.getTransaction(first.value.reference);
    expect(transaction.value).toStrictEqual({
      reference: first.value.reference,
      externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
      status: 'successful',
      amount: 500,
      currency: 'XAF',
    });
  });

  it('fails the payment of a number ending with 00', async () => {
    const gateway = new FakeGateway();
    const collected = await gateway.collect(request('+237699000100'));
    const transaction = await gateway.getTransaction(collected.value.reference);
    expect(transaction.value.status).toBe('failed');
  });

  it('reports an unknown transaction as unavailable (lost on restart)', async () => {
    const transaction = await new FakeGateway().getTransaction('fake-x');
    expect(transaction.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
  });

  it('accepts notifications signed with the fake key only', () => {
    const gateway = new FakeGateway();
    expect(
      gateway.verifyNotification({
        reference: 'fake-x',
        external_reference: 'ext',
        signature: signFakeNotification(),
      }).value,
    ).toStrictEqual({ reference: 'fake-x', externalReference: 'ext' });
    expect(
      gateway.verifyNotification({ reference: 'fake-x', signature: signFakeNotification() }).value
        .externalReference,
    ).toBeNull();
    expect(gateway.verifyNotification({ reference: 'fake-x', signature: 'a.b.c' }).isErr()).toBe(
      true,
    );
    expect(gateway.verifyNotification({ signature: signFakeNotification() }).isErr()).toBe(true);
  });
});

describe('DisabledGateway', () => {
  it('has no provider and refuses everything', async () => {
    const gateway = new DisabledGateway();
    const collected = await gateway.collect();
    const transaction = await gateway.getTransaction();
    expect(gateway.provider).toBeNull();
    expect(collected.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
    expect(transaction.error.code).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
    expect(gateway.verifyNotification().error.code).toBe('UNAUTHORIZED_PAYMENT_NOTIFICATION');
  });
});
