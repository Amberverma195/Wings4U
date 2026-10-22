import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../../database/prisma.service";
import { CartQuoteDto } from "./cart.controller";
import { isBoundedCustomization } from "./bounded-customization";
import { Test } from "@nestjs/testing";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { configureApp } from "../../app.setup";
import request from "supertest";
const ID = "11111111-1111-4111-8111-111111111111";
const item = { menu_item_id: ID, quantity: 999, modifier_selections: [{ modifier_option_id: ID }], removed_ingredients: [{ id: ID, name: "Onion" }], special_instructions: "Sauce on side", builder_payload: { builder_type: "WINGS", weight_lb: 20, flavour_slots: Array.from({ length: 20 }, (_, i) => ({ slot_no: i + 1, wing_flavour_id: ID, flavour_name: "BBQ", placement: "ON_SIDE" })), salad_customization: { salad_menu_item_id: ID, modifier_selections: [{ modifier_option_id: ID }], removed_ingredients: [] } } };
const body = (items: any[] = [item]) => ({ location_id: ID, fulfillment_type: "PICKUP", items });
const errors = (value: unknown) => validate(plainToInstance(CartQuoteDto, value), { whitelist: true, forbidUnknownValues: true });
it("accepts ordinary carts and 200 large party-builder lines", async () => {
  expect(await errors(body())).toHaveLength(0);
  expect(await errors(body(Array(200).fill(item)))).toHaveLength(0);
});
it.each([
  body(Array(201).fill(item)), body([{ ...item, modifier_selections: Array(129).fill({ modifier_option_id: ID }) }]),
  body([{ ...item, removed_ingredients: Array(65).fill({ id: ID, name: "Onion" }) }]),
  body([{ ...item, special_instructions: "x".repeat(2001) }]),
  body([{ ...item, modifier_selections: [{ modifier_option_id: "bad" }] }]),
  body([{ ...item, builder_payload: { nested: Array(129).fill("x") } }]),
])("rejects oversized or malformed nested cart data", async value => { expect((await errors(value)).length).toBeGreaterThan(0); });
it("rejects depth, breadth and aggregate structured-data attacks", () => {
  let deep: any = {}; for (let i = 0; i < 10; i++) deep = { child: deep };
  expect(isBoundedCustomization(deep)).toBe(false);
  expect(isBoundedCustomization({ values: Array(128).fill("x".repeat(1000)) })).toBe(false);
  expect(isBoundedCustomization({ nested: [{ name: "Normal", id: ID }] })).toBe(true);
});
it("rejects oversized and deeply nested JSON before the quote service and preserves API error envelopes", async () => {
  const quote = jest.fn();
  const module = await Test.createTestingModule({ controllers: [CartController], providers: [
    { provide: PrismaService, useValue: {} },
    { provide: CartService, useValue: { computeQuote: quote } }, { provide: RateLimiterService, useValue: { enforce: jest.fn() } },
  ] }).compile();
  const app = module.createNestApplication(); configureApp(app); await app.init();
  try {
    await request(app.getHttpServer()).post('/api/v1/cart/quote').set('X-Location-Id', ID).send(body(Array(200).fill(item))).expect(201);
    expect(quote).toHaveBeenCalledTimes(1); quote.mockClear();
    const oversized = await request(app.getHttpServer()).post('/api/v1/cart/quote').send({ value: 'x'.repeat(1024 * 1024) });
    expect(oversized.status).toBe(413); expect(oversized.body.errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    const nested = await request(app.getHttpServer()).post('/api/v1/cart/quote').set('Content-Type', 'application/json').send('{"value":' + '['.repeat(20) + '0' + ']'.repeat(20) + '}');
    expect(nested.status).toBe(413); expect(quote).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
