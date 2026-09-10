import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { Payment, PAYMENT_STATUS } from '../src/models/Payment.js';
import { Invoice, INVOICE_STATUS } from '../src/models/Invoice.js';
import { env } from '../src/config/env.js';

/**
 * What a practice has been charged, and where it comes from.
 *
 * The provider is authoritative and this is an index over it — enough to show a
 * clinic its own history and link to the real document, because "why was I
 * charged this" is a question they ask us rather than Razorpay, where they hold
 * no account.
 */

const SECRET = 'history_test_webhook_secret';
let origin;
let realSecret;

async function deliver(event, payload) {
  const body = JSON.stringify({ event, payload });
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(`${origin}/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': `evt_${Math.random().toString(16).slice(2)}`,
    },
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A charge as Razorpay actually delivers one. */
function charged({ subId = 'sub_hist', payId = 'pay_1', invId = 'inv_1', status = 'captured' } = {}) {
  return {
    subscription: { entity: { id: subId } },
    payment: {
      entity: {
        id: payId,
        amount: 399900,
        currency: 'INR',
        status,
        method: 'card',
        invoice_id: invId,
        created_at: 1789000000,
        ...(status === 'failed' ? { error_description: 'Your card was declined.' } : {}),
      },
    },
    invoice: {
      entity: {
        id: invId,
        invoice_number: 'INV-0007',
        amount: 338900,
        tax_amount: 61000,
        gross_amount: 399900,
        currency: 'INR',
        status: status === 'captured' ? 'paid' : 'issued',
        billing_start: 1789000000,
        billing_end: 1791592000,
        short_url: 'https://rzp.io/i/invoice7',
        issued_at: 1789000000,
        paid_at: status === 'captured' ? 1789000100 : null,
      },
    },
  };
}

describe('a charge is filed as it arrives', () => {
  before(async () => {
    origin = await boot();
    realSecret = env.RAZORPAY_WEBHOOK_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  after(async () => {
    env.RAZORPAY_WEBHOOK_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(wipe);

  async function setup() {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.TRIAL });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_hist',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });
    return { practice, owner };
  }

  test('the payment and the invoice both land', async () => {
    const { practice } = await setup();
    await deliver('subscription.charged', charged());

    const pay = await Payment.findOne({ providerPaymentId: 'pay_1' }).lean();
    assert.equal(pay.status, PAYMENT_STATUS.CAPTURED);
    assert.equal(pay.amount, 399900);
    assert.equal(pay.method, 'card');
    assert.equal(String(pay.practice), String(practice._id));

    const inv = await Invoice.findOne({ providerInvoiceId: 'inv_1' }).lean();
    assert.equal(inv.status, INVOICE_STATUS.PAID);
    assert.equal(inv.number, 'INV-0007');
    assert.equal(inv.url ?? inv.shortUrl, 'https://rzp.io/i/invoice7');
  });

  test('the tax is theirs, not computed here', async () => {
    // A GST figure on a clinic's books must not depend on a percentage
    // somebody typed into this codebase. 338900 + 61000 = 399900, and all
    // three come off the wire.
    await setup();
    await deliver('subscription.charged', charged());

    const inv = await Invoice.findOne({ providerInvoiceId: 'inv_1' }).lean();
    assert.equal(inv.amount, 338900);
    assert.equal(inv.tax, 61000);
    assert.equal(inv.total, 399900);
  });

  test('a redelivery does not bill them twice', async () => {
    /*
     * The worst thing a billing history can say. Razorpay delivers at least
     * once, so this is normal operation rather than an attack — and two rows
     * for one debit leaves a practice unable to tell which was real.
     */
    await setup();
    await deliver('subscription.charged', charged());
    await deliver('subscription.charged', charged());

    assert.equal(await Payment.countDocuments({ providerPaymentId: 'pay_1' }), 1);
    assert.equal(await Invoice.countDocuments({ providerInvoiceId: 'inv_1' }), 1);
  });

  test('a failed charge is kept, with the provider’s reason', async () => {
    // "Your card was declined" and "your bank is down" need different actions,
    // and a single "payment failed" sends somebody to re-enter a card that was
    // never the problem.
    await setup();
    await deliver('subscription.pending', charged({ payId: 'pay_2', status: 'failed' }));

    const pay = await Payment.findOne({ providerPaymentId: 'pay_2' }).lean();
    assert.equal(pay.status, PAYMENT_STATUS.FAILED);
    assert.equal(pay.failureReason, 'Your card was declined.');
  });

  test('the date is the provider’s, not ours', async () => {
    // A webhook delayed four hours must not date a charge four hours late.
    await setup();
    await deliver('subscription.charged', charged());

    const pay = await Payment.findOne({ providerPaymentId: 'pay_1' }).lean();
    assert.equal(new Date(pay.at).getTime(), 1789000000 * 1000);
  });

  test('no card detail is stored, whatever they send', async () => {
    // The property that keeps this server out of PCI scope.
    await setup();
    const payload = charged();
    payload.payment.entity.card = { last4: '1111', network: 'Visa' };
    await deliver('subscription.charged', payload);

    const pay = await Payment.findOne({ providerPaymentId: 'pay_1' }).lean();
    assert.doesNotMatch(JSON.stringify(pay), /1111|last4|Visa/);
  });

  test('a delivery with no payment still updates the subscription', async () => {
    // Most subscription events carry no payment at all. Filing must be optional
    // and its absence must not break the status update the webhook exists for.
    await setup();
    const res = await deliver('subscription.halted', {
      subscription: { entity: { id: 'sub_hist' } },
    });
    assert.equal(res.status, 200);

    const sub = await Subscription.findOne({ providerSubscriptionId: 'sub_hist' }).lean();
    assert.equal(sub.status, SUBSCRIPTION_STATUS.HALTED);
    assert.equal(await Payment.countDocuments(), 0);
  });
});

describe('and the practice can read it back', () => {
  before(async () => {
    origin = await boot();
    realSecret = env.RAZORPAY_WEBHOOK_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  after(async () => {
    env.RAZORPAY_WEBHOOK_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(wipe);

  test('newest first, with the invoice link', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await Payment.create([
      {
        practice: practice._id,
        providerPaymentId: 'pay_old',
        amount: 399900,
        status: PAYMENT_STATUS.CAPTURED,
        at: new Date('2026-07-01'),
      },
      {
        practice: practice._id,
        providerPaymentId: 'pay_new',
        amount: 399900,
        status: PAYMENT_STATUS.CAPTURED,
        at: new Date('2026-08-01'),
      },
    ]);

    const res = await as(owner.token).get('/billing/history');
    assert.equal(res.status, 200);
    assert.equal(res.body.payments[0].providerPaymentId, 'pay_new');
    assert.equal(res.body.payments.length, 2);
  });

  test('and never another practice’s', async () => {
    // The same boundary as everywhere else, on a surface that names amounts.
    const mine = await makePractice('Sunrise Diabetes Care');
    const bose = await makeMember(mine, { name: 'Dr Bose', isOwner: true });

    const theirs = await makePractice('Meridian Family Clinic');
    await Payment.create({
      practice: theirs._id,
      providerPaymentId: 'pay_theirs',
      amount: 999900,
      status: PAYMENT_STATUS.CAPTURED,
      at: new Date(),
    });
    await Invoice.create({
      practice: theirs._id,
      providerInvoiceId: 'inv_theirs',
      amount: 999900,
      total: 999900,
      status: INVOICE_STATUS.PAID,
      issuedAt: new Date(),
    });

    const res = await as(bose.token).get('/billing/history');
    assert.doesNotMatch(JSON.stringify(res.body), /pay_theirs|inv_theirs|999900/);
    assert.equal(res.body.payments.length, 0);
  });

  test('a practice with no history gets empty lists, not an error', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });

    const res = await as(owner.token).get('/billing/history');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.payments, []);
    assert.deepEqual(res.body.invoices, []);
  });
});
