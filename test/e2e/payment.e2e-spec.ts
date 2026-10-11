import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';
import { OFFER_CATALOG } from '@/modules/billing/domain/ports/offer-catalog.port';
import { PURCHASE_LEDGER } from '@/modules/billing/domain/ports/purchase-ledger.port';
import { UNITS_LEDGER } from '@/modules/billing/domain/ports/units-ledger.port';
import { WALLET_HISTORY } from '@/modules/billing/domain/ports/wallet-history.port';
import { QUOTA_POLICY } from '@/modules/billing/domain/quota-policy';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '@/modules/identity/interface/http/session.guard';
import { ReconcilePendingPaymentsUseCase } from '@/modules/payment/application/use-cases/reconcile-pending-payments.use-case';
import { type Payment } from '@/modules/payment/domain/entities/payment.entity';
import { PAYMENT_REPOSITORY } from '@/modules/payment/domain/ports/payment-repository.port';
import { signFakeNotification } from '@/modules/payment/infrastructure/gateway/fake.gateway';
import { UnauthorizedError } from '@/shared/kernel';
import { UNIT_OF_WORK } from '@/shared/persistence/unit-of-work.port';
import { OBJECT_STORAGE } from '@/shared/storage';

import { bootstrapTestApp } from '../support';
import {
  FakeObjectStorage,
  ImmediateUnitOfWork,
  InMemoryBilling,
  InMemoryPaymentRepository,
} from '../support/fakes';

const USER_HEADER = 'x-test-user';
const POLICY = { freeTierUnitsPerMonth: 1000, maxCharsPerConversion: 800 };

const headerSessionGuard: CanActivate = {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = req.headers[USER_HEADER];
    if (typeof id !== 'string') throw new UnauthorizedError('Session required');
    req.authUser = { id, email: `${id}@test.cm`, role: 'user' as never };
    return true;
  },
};

/**
 * E2E paiement (ADR-0021) : AppModule complet — contrôleurs, use-cases,
 * `FakeGateway` (`PAYMENT_PROVIDER=fake`, défaut hors production), adapter
 * vers les use-cases réels de `billing` et filtre RFC 7807 ; seule la
 * persistance est un fake.
 */
describe('payments (e2e)', () => {
  let app: INestApplication;
  let payments: InMemoryPaymentRepository;

  beforeEach(async () => {
    payments = new InMemoryPaymentRepository();
    const billing = new InMemoryBilling();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_REPOSITORY)
      .useValue(payments)
      .overrideProvider(UNITS_LEDGER)
      .useValue(billing)
      .overrideProvider(PURCHASE_LEDGER)
      .useValue(billing)
      .overrideProvider(OFFER_CATALOG)
      .useValue(billing)
      .overrideProvider(WALLET_HISTORY)
      .useValue(billing)
      .overrideProvider(QUOTA_POLICY)
      .useValue(POLICY)
      .overrideProvider(UNIT_OF_WORK)
      .useValue(new ImmediateUnitOfWork())
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new FakeObjectStorage())
      .overrideGuard(SessionGuard)
      .useValue(headerSessionGuard)
      .compile();
    app = await bootstrapTestApp(moduleFixture);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const buy = (body: Record<string, unknown>, key = 'purchase-0001', user = 'alice') =>
    http().post('/v1/payments').set(USER_HEADER, user).set('Idempotency-Key', key).send(body);

  /** Ce que Campay enverrait : signé, avec nos deux références. */
  function notificationFor(payment: Payment) {
    return {
      status: 'SUCCESSFUL',
      reference: payment.providerReference,
      external_reference: payment.externalReference,
      amount: '1',
      currency: 'XAF',
      phone_number: '237699000012',
      signature: signFakeNotification(),
    };
  }

  function stored(id: string): Payment {
    const payment = payments.rows.get(id);
    if (payment === undefined) throw new Error(`No payment ${id}`);
    return payment;
  }

  it('pays a pass: request, signed notification, pass visible on the account', async () => {
    const created = await buy({ offerCode: 'pass-30d', phoneNumber: '6 99 00 00 12' }).expect(202);
    expect(created.body).toStrictEqual({
      id: expect.any(String) as string,
      status: 'pending',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      phoneSuffix: '12',
      failureCode: null,
      createdAt: expect.any(String) as string,
      completedAt: null,
    });
    const id = created.body.id as string;

    // Double appui : même paiement, aucune nouvelle demande au téléphone.
    const again = await buy({ offerCode: 'pass-30d', phoneNumber: '+237699000012' }).expect(202);
    expect(again.body.id).toBe(id);

    // Le montant annoncé par la notification (1) n'est pas lu : l'état est relu.
    await http()
      .post('/v1/webhooks/campay')
      .send(notificationFor(stored(id)))
      .expect(200, {
        received: true,
      });

    const paid = await http().get(`/v1/payments/${id}`).set(USER_HEADER, 'alice').expect(200);
    expect(paid.body).toMatchObject({ id, status: 'succeeded', failureCode: null });
    expect(paid.body.completedAt).toEqual(expect.any(String));
    const account = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
    expect(account.body.pass).toMatchObject({ includedUnits: 250_000, usedUnits: 0 });

    // Notification rejouée : rien de plus.
    await http()
      .post('/v1/webhooks/campay')
      .send(notificationFor(stored(id)))
      .expect(200);
    const replayed = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
    expect(replayed.body.nextPassStartsAt).toBeNull();
  });

  it('confirms by the reconciliation sweep when the notification never comes', async () => {
    const created = await buy({ offerCode: 'credits-s', phoneNumber: '699000012' }).expect(202);
    const id = created.body.id as string;
    // Trois minutes plus tard : au-delà du délai laissé à la notification.
    payments.rows.set(id, { ...stored(id), createdAt: new Date(Date.now() - 3 * 60_000) });

    const report = await app.get(ReconcilePendingPaymentsUseCase).execute();

    expect(report).toMatchObject({ examined: 1, succeeded: 1 });
    expect(stored(id)).toMatchObject({ status: 'succeeded', confirmedVia: 'sweep' });
    const account = await http().get('/v1/billing/account').set(USER_HEADER, 'alice').expect(200);
    expect(account.body.credits).toBe(50_000);
  });

  it('marks a declined payment failed (fake: number ending with 00)', async () => {
    const created = await buy({ offerCode: 'credits-s', phoneNumber: '699000100' }).expect(202);
    const id = created.body.id as string;
    await http()
      .post('/v1/webhooks/campay')
      .send(notificationFor(stored(id)))
      .expect(200);
    const failed = await http().get(`/v1/payments/${id}`).set(USER_HEADER, 'alice').expect(200);
    expect(failed.body).toMatchObject({ status: 'failed', failureCode: 'declined' });
  });

  it('refuses a second purchase while one waits for confirmation', async () => {
    const first = await buy({ offerCode: 'credits-s', phoneNumber: '699000012' }).expect(202);
    const second = await buy({ offerCode: 'pass-30d', phoneNumber: '699000012' }, 'purchase-0002');
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'PAYMENT_IN_PROGRESS_CONFLICT',
      details: { paymentId: first.body.id as string },
    });
  });

  it.each([
    [
      'an unknown offer',
      { offerCode: 'credits-xl', phoneNumber: '699000012' },
      404,
      'OFFER_NOT_FOUND',
    ],
    [
      'a foreign phone',
      { offerCode: 'credits-s', phoneNumber: '+33612345678' },
      422,
      'INVALID_PAYMENT_PHONE',
    ],
  ])('rejects %s as Problem Details', async (_label, body, status, code) => {
    const response = await buy(body).expect(status);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.code).toBe(code);
    expect(payments.rows.size).toBe(0);
  });

  it('requires an Idempotency-Key', async () => {
    const response = await http()
      .post('/v1/payments')
      .set(USER_HEADER, 'alice')
      .send({ offerCode: 'credits-s', phoneNumber: '699000012' })
      .expect(422);
    expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('refuses the same key for a different purchase', async () => {
    await buy({ offerCode: 'credits-s', phoneNumber: '699000012' }).expect(202);
    const response = await buy({ offerCode: 'pass-30d', phoneNumber: '699000012' }).expect(409);
    expect(response.body.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');
  });

  it('rejects a malformed body before any use-case', async () => {
    await buy({ offerCode: 42 }).expect(400);
    expect(payments.rows.size).toBe(0);
  });

  it('requires a session to pay or read, and hides the payments of others', async () => {
    await http().post('/v1/payments').send({}).expect(401);
    const created = await buy({ offerCode: 'credits-s', phoneNumber: '699000012' }).expect(202);
    const id = created.body.id as string;
    await http().get(`/v1/payments/${id}`).expect(401);
    const other = await http().get(`/v1/payments/${id}`).set(USER_HEADER, 'bob').expect(404);
    expect(other.body.code).toBe('PAYMENT_NOT_FOUND');
    await http().get('/v1/payments/not-a-uuid').set(USER_HEADER, 'alice').expect(400);
  });

  describe('webhook', () => {
    it('needs no session but a valid signature, and grants nothing otherwise', async () => {
      const created = await buy({ offerCode: 'credits-s', phoneNumber: '699000012' }).expect(202);
      const forged = { ...notificationFor(stored(created.body.id as string)), signature: 'a.b.c' };

      const response = await http().post('/v1/webhooks/campay').send(forged).expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED_PAYMENT_NOTIFICATION');
      expect(stored(created.body.id as string).status).toBe('pending');
    });

    it('acknowledges a signed notification for an unknown payment, so that it stops', async () => {
      const response = await http()
        .post('/v1/webhooks/campay')
        .send({ reference: 'fake-unknown', signature: signFakeNotification() });
      expect(response.status).toBe(200);
      expect(response.body).toStrictEqual({ received: true });
    });

    it('refuses a body that is not an object', async () => {
      const response = await http()
        .post('/v1/webhooks/campay')
        .set('content-type', 'application/json')
        .send('[1,2]');
      expect(response.status).toBe(401);
    });
  });
});
