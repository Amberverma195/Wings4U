import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import Stripe from "stripe";
import { CartService } from "../cart/cart.service";
import { buildCheckoutCartHash } from "./checkout-cart-hash";

const STRIPE_SECRET_PLACEHOLDER = "sk_test_placeholder";
const STRIPE_PUBLISHABLE_PLACEHOLDER = "pk_test_placeholder";
type StripeClient = Stripe.Stripe;

type StripeCheckoutItemInput = {
  menu_item_id: string;
  quantity: number;
  modifier_selections?: { modifier_option_id: string }[];
  removed_ingredients?: { id: string; name: string }[];
  special_instructions?: string;
  builder_payload?: Record<string, unknown>;
};

type CreatePaymentIntentParams = {
  userId: string;
  locationId: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  items: StripeCheckoutItemInput[];
  promoCode?: string;
  driverTipCents?: number;
  walletAppliedCents?: number;
  scheduledFor?: string;
  applyWingsReward?: boolean;
  deliveryQuoteToken?: string;
  addressSnapshotJson?: Record<string, unknown>;
};

export type VerifiedStripePayment = {
  paymentIntentId: string;
  amountReceivedCents: number;
  currency: string;
  providerPayload: Record<string, unknown>;
};

function getStripeSecretKey(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() || STRIPE_SECRET_PLACEHOLDER;
}

function getStripePublishableKey(): string {
  return (
    process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    STRIPE_PUBLISHABLE_PLACEHOLDER
  );
}

function getStripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || "whsec_placeholder";
}

function getStripeCurrency(): string {
  const candidate = (process.env.STRIPE_CURRENCY ?? "cad").trim().toLowerCase();
  return /^[a-z]{3}$/.test(candidate) ? candidate : "cad";
}

function isPlaceholderKey(key: string): boolean {
  const lower = key.toLowerCase();
  return !key || lower.includes("placeholder") || lower.includes("change-me");
}

function isStripeConfigured(): boolean {
  const secretKey = getStripeSecretKey();
  const publishableKey = getStripePublishableKey();
  return (
    secretKey.startsWith("sk_") &&
    publishableKey.startsWith("pk_") &&
    !isPlaceholderKey(secretKey) &&
    !isPlaceholderKey(publishableKey)
  );
}

function isStripeWebhookConfigured(): boolean {
  const webhookSecret = getStripeWebhookSecret();
  return webhookSecret.startsWith("whsec_") && !isPlaceholderKey(webhookSecret);
}

@Injectable()
export class StripePaymentsService {
  private stripeClient: StripeClient | null = null;

  constructor(private readonly cartService: CartService) {}

  getPublicConfig() {
    return {
      configured: isStripeConfigured(),
      publishable_key: getStripePublishableKey(),
      currency: getStripeCurrency().toUpperCase(),
      merchant_display_name:
        process.env.STRIPE_MERCHANT_DISPLAY_NAME?.trim() || "Wings4U",
    };
  }

  async createCheckoutPaymentIntent(params: CreatePaymentIntentParams) {
    const config = this.getPublicConfig();
    if (!config.configured) {
      return {
        ...config,
        payment_intent_id: null,
        client_secret: null,
        amount_cents: null,
        message:
          "Stripe is not configured yet. Replace STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY placeholders to enable online card payments.",
      };
    }

    const quote = await this.cartService.computeQuote(
      params.locationId,
      params.fulfillmentType,
      params.items,
      params.promoCode,
      params.driverTipCents,
      params.walletAppliedCents,
      params.scheduledFor,
      params.userId,
      params.applyWingsReward,
      params.deliveryQuoteToken,
      params.addressSnapshotJson,
      true,
    );

    if (quote.final_payable_cents <= 0) {
      throw new UnprocessableEntityException({
        message: "Online card payment is only needed when the payable total is above $0.",
        field: "final_payable_cents",
      });
    }

    const cartHash = buildCheckoutCartHash({
      location_id: params.locationId,
      fulfillment_type: params.fulfillmentType,
      items: params.items,
      promo_code: params.promoCode,
      driver_tip_cents: params.driverTipCents ?? 0,
      wallet_applied_cents: params.walletAppliedCents ?? 0,
      scheduled_for: params.scheduledFor,
      apply_wings_reward: params.applyWingsReward ?? false,
      delivery_quote_token: params.deliveryQuoteToken,
      delivery_fee_stated_cents: quote.delivery_fee_stated_cents,
      address_snapshot_json: params.addressSnapshotJson,
    });

    const intent = await this.getStripeClient().paymentIntents.create({
      amount: quote.final_payable_cents,
      currency: getStripeCurrency(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        wings4u_user_id: params.userId,
        wings4u_location_id: params.locationId,
        wings4u_fulfillment_type: params.fulfillmentType,
        wings4u_cart_hash: cartHash,
        wings4u_amount_cents: String(quote.final_payable_cents),
      },
    });

    return {
      ...config,
      payment_intent_id: intent.id,
      client_secret: intent.client_secret,
      amount_cents: quote.final_payable_cents,
      quote,
    };
  }

  async verifySucceededPaymentIntent(params: {
    paymentIntentId: string;
    userId: string;
    locationId: string;
    amountCents: number;
    currency?: string;
    cartHash: string;
  }): Promise<VerifiedStripePayment> {
    if (!isStripeConfigured()) {
      throw new ServiceUnavailableException(
        "Stripe is not configured. Replace the placeholder Stripe keys before accepting online payments.",
      );
    }

    const intent = await this.getStripeClient().paymentIntents.retrieve(
      params.paymentIntentId,
    );
    const expectedCurrency = (params.currency ?? getStripeCurrency()).toLowerCase();

    if (intent.status !== "succeeded") {
      throw new UnprocessableEntityException({
        message: "Stripe payment has not been completed.",
        field: "stripe_payment_intent_id",
        stripe_status: intent.status,
      });
    }

    if (intent.currency.toLowerCase() !== expectedCurrency) {
      throw new UnprocessableEntityException({
        message: "Stripe payment currency does not match checkout currency.",
        field: "stripe_payment_intent_id",
      });
    }

    if (intent.amount_received !== params.amountCents) {
      throw new UnprocessableEntityException({
        message: "Stripe payment amount does not match checkout total.",
        field: "stripe_payment_intent_id",
      });
    }

    if (
      intent.metadata.wings4u_location_id &&
      intent.metadata.wings4u_location_id !== params.locationId
    ) {
      throw new UnprocessableEntityException({
        message: "Stripe payment was created for a different location.",
        field: "stripe_payment_intent_id",
      });
    }

    if (
      intent.metadata.wings4u_user_id &&
      intent.metadata.wings4u_user_id !== params.userId
    ) {
      throw new UnprocessableEntityException({
        message: "Stripe payment was created for a different customer.",
        field: "stripe_payment_intent_id",
      });
    }
    if (intent.metadata.wings4u_cart_hash !== params.cartHash) {
      throw new UnprocessableEntityException({
        message: "Stripe payment does not match the submitted cart.",
        field: "stripe_payment_intent_id",
      });
    }

    return {
      paymentIntentId: intent.id,
      amountReceivedCents: intent.amount_received,
      currency: intent.currency.toUpperCase(),
      providerPayload: {
        id: intent.id,
        amount: intent.amount,
        amount_received: intent.amount_received,
        currency: intent.currency,
        status: intent.status,
        payment_method: intent.payment_method,
        latest_charge: intent.latest_charge,
        metadata: intent.metadata,
      },
    };
  }

  handleWebhook(params: { rawBody?: Buffer; signature?: string }) {
    if (!isStripeWebhookConfigured()) {
      return {
        received: true,
        configured: false,
        message:
          "Stripe webhook secret is still a placeholder; webhook verification is disabled.",
      };
    }

    if (!params.rawBody) {
      throw new BadRequestException("Stripe webhook raw body is required");
    }
    if (!params.signature) {
      throw new BadRequestException("Stripe-Signature header is required");
    }

    const event = this.getStripeClient().webhooks.constructEvent(
      params.rawBody,
      params.signature,
      getStripeWebhookSecret(),
    );

    return {
      received: true,
      configured: true,
      event_id: event.id,
      event_type: event.type,
    };
  }

  private getStripeClient(): StripeClient {
    if (!this.stripeClient) {
      this.stripeClient = new Stripe(getStripeSecretKey());
    }
    return this.stripeClient;
  }
}
