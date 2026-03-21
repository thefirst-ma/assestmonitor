import Stripe from 'stripe';
import { database } from '../database';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3001';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!STRIPE_SECRET_KEY) throw new Error('Stripe 未配置，请设置 STRIPE_SECRET_KEY');
    stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripe;
}

export class StripeService {
  async createCheckoutSession(userId: string, email: string): Promise<string> {
    const s = getStripe();

    let user = database.getUserById(userId);
    if (!user) throw new Error('用户不存在');

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      database.updateStripeCustomer(userId, customerId);
    }

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${SITE_URL}?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${SITE_URL}?status=cancelled`,
      metadata: { userId }
    });

    return session.url || '';
  }

  async createPortalSession(userId: string): Promise<string> {
    const s = getStripe();
    const user = database.getUserById(userId);
    if (!user?.stripeCustomerId) throw new Error('未找到订阅信息');

    const session = await s.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: SITE_URL
    });

    return session.url;
  }

  handleWebhookEvent(payload: Buffer, signature: string): void {
    const s = getStripe();
    let event: Stripe.Event;

    try {
      event = s.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      throw new Error(`Webhook 签名验证失败: ${err.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (userId) {
          database.updateUserPlan(
            userId, 'pro',
            session.customer as string,
            session.subscription as string
          );
          console.log(`✅ 用户 ${userId} 已升级为 Pro`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const user = database.getUserByStripeCustomerId(customerId);
        if (user) {
          database.updateUserPlan(user.id, 'free', user.stripeCustomerId, undefined);
          console.log(`⬇️ 用户 ${user.id} 已降级为 Free`);
        }
        break;
      }
    }
  }

  isConfigured(): boolean {
    return !!STRIPE_SECRET_KEY && !!STRIPE_PRICE_ID;
  }
}

export const stripeService = new StripeService();
