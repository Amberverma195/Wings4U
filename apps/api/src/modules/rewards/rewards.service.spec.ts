import {
  RewardsService,
  summarizeWingsInCart,
  sumRewardablePaidWingsPounds,
  type WingsAwardOrderLine,
  type WingsCartLine,
} from "./rewards.service";

describe("summarizeWingsInCart", () => {
  function wingsLine(overrides: Partial<WingsCartLine>): WingsCartLine {
    return {
      quantity: 1,
      menuItemSlug: "wings-1lb",
      basePriceCents: 1299,
      unitPriceCents: 1299,
      lineTotalCents: 1299,
      builderPayload: {
        builder_type: "WINGS",
        weight_lb: 1,
      },
      ...overrides,
    };
  }

  it("counts individual 1lb wings and discounts only the base 1lb price", () => {
    const summary = summarizeWingsInCart([
      wingsLine({
        quantity: 2,
        basePriceCents: 1299,
        unitPriceCents: 1699,
        lineTotalCents: 3398,
      }),
    ]);

    expect(summary).toEqual({
      poundsInCart: 2,
      cheapestPerLbCents: 1299,
    });
  });

  it("does not count party packs or wing combos as redeemable 1lb wings", () => {
    const summary = summarizeWingsInCart([
      wingsLine({
        menuItemSlug: "party-75-wings",
        basePriceCents: 8999,
        unitPriceCents: 8999,
        lineTotalCents: 8999,
        builderPayload: {
          builder_type: "WINGS",
          weight_lb: 5,
        },
      }),
      wingsLine({
        menuItemSlug: "wing-combo-1lb",
        builderPayload: {
          builder_type: "WING_COMBO",
          weight_lb: 1,
        },
      }),
    ]);

    expect(summary).toEqual({
      poundsInCart: 0,
      cheapestPerLbCents: 0,
    });
  });
});

describe('official earning portions and completion ledger', () => {
  const line = (slug: string, quantity = 1, weight: unknown = 999): WingsAwardOrderLine => ({ quantity, menuItemSlug: slug,
    builderType: slug.startsWith('combo-') ? 'WING_COMBO' : 'WINGS', builderPayload: { weight_lb: weight } });
  it.each([
    [[line('party-75-wings')], 8], [[line('party-100-wings')], 11],
    [[line('party-75-wings', 2)], 16], [[line('party-100-wings', 2)], 22],
    [[line('party-75-wings'), line('party-100-wings')], 19],
    [[line('wings-1lb'), line('wings-1.5lb'), line('wings-2lb'), line('wings-2.5lb'), line('wings-3lb'), line('wings-4lb'), line('wings-5lb')], 19],
    [[line('combo-1.5lb', 2), line('party-75-wings')], 11],
    [[line('lunch-5-wings'), line('unknown'), line('wings-7lb')], 0],
  ] as Array<[WingsAwardOrderLine[], number]>)('uses trusted SKU identities for %j => %s pounds', (lines, expected) => {
    expect(sumRewardablePaidWingsPounds(lines)).toBe(expected);
  });
  function fixture(lines: WingsAwardOrderLine[], balance = 0, redeemed = false, status = 'PICKED_UP', customer: string | null = 'customer') {
    const summary = { availableStamps: balance, lifetimeStamps: 20, lifetimeRedemptions: 2 };
    const entries: any[] = redeemed ? [{ id: 'redemption', entryType: 'REDEEMED' }] : [];
    const tx = {
      order: { findUnique: jest.fn().mockResolvedValue({ id: 'order', status, customerUserId: customer,
        orderItems: lines.map(row => ({ ...row, menuItem: { slug: row.menuItemSlug }, builderPayloadJson: row.builderPayload })) }) },
      customerWingsStampLedger: {
        findFirst: jest.fn(async ({ where }) => entries.find(row => row.entryType === where.entryType) ?? null),
        create: jest.fn(async ({ data }) => { entries.push({ id: 'earned', ...data }); return data; }),
      },
      customerWingsRewards: {
        upsert: jest.fn(async () => ({ ...summary })),
        update: jest.fn(async ({ data }) => { summary.availableStamps += data.availableStamps.increment; summary.lifetimeStamps += data.lifetimeStamps.increment; return { ...summary }; }),
      },
    };
    return { tx, entries, summary, run: () => new RewardsService({} as never).accrueForOrderInTransaction(tx as never, 'order') };
  }
  it.each([
    { lines: [line('party-75-wings')], balance: 0, earned: 8, credited: 8 },
    { lines: [line('party-100-wings')], balance: 0, earned: 11, credited: 8 },
    { lines: [line('party-75-wings', 2)], balance: 0, earned: 16, credited: 8 },
    { lines: [line('party-100-wings', 2)], balance: 0, earned: 22, credited: 8 },
    { lines: [line('party-75-wings'), line('party-100-wings')], balance: 0, earned: 19, credited: 8 },
    { lines: [line('wings-1.5lb'), line('party-75-wings')], balance: 0, earned: 9, credited: 8 },
    { lines: [line('party-100-wings')], balance: 7, earned: 11, credited: 1 },
    { lines: [line('party-75-wings', 2)], balance: 8, earned: 16, credited: 0 },
    { lines: [line('wings-1.5lb'), line('wings-2.5lb')], balance: 0, earned: 4, credited: 4 },
    { lines: [line('wings-1.5lb', 3)], balance: 0, earned: 4, credited: 4 },
  ])('preserves cap and lifetime accounting: $earned calculated / $credited credited at balance $balance', async ({ lines, balance, earned, credited }) => {
    const f = fixture(lines, balance); await f.run();
    expect(f.summary).toEqual({ availableStamps: balance + credited, lifetimeStamps: 20 + earned, lifetimeRedemptions: 2 });
    expect(f.entries[0]).toMatchObject({ entryType: 'EARNED', deltaStamps: credited, balanceAfterStamps: balance + credited });
    if (credited < earned) expect(f.entries[0].reasonText).toContain(`${earned} stamps (${credited} credited`);
    await f.run();
    expect(f.entries).toHaveLength(1); expect(f.tx.customerWingsRewards.update).toHaveBeenCalledTimes(1);
  });
  it('excludes the redeemed free pound while retaining Party Special earning', async () => {
    const f = fixture([line('party-100-wings'), line('wings-1lb')], 0, true, 'DELIVERED'); await f.run();
    expect(f.summary).toMatchObject({ availableStamps: 8, lifetimeStamps: 31 });
    expect(f.entries[1]).toMatchObject({ poundsAwarded: 11, deltaStamps: 8 });
    const freeOnly = fixture([line('wings-1lb')], 0, true); await freeOnly.run(); expect(freeOnly.entries).toHaveLength(1);
  });
  it.each(['PICKED_UP', 'DELIVERED', 'NO_PIN_DELIVERY'])('preserves earning on the existing qualifying completion (%s)', async status => {
    const f = fixture([line('party-100-wings')], 0, false, status); await f.run();
    expect(f.summary).toMatchObject({ availableStamps: 8, lifetimeStamps: 31 });
    expect(f.entries[0]).toMatchObject({ entryType: 'EARNED', deltaStamps: 8, poundsAwarded: 11 });
  });
  it.each(['PICKED_UP', 'DELIVERED', 'NO_PIN_DELIVERY'].flatMap(status => [
    { status, lines: [line('lunch-5-wings', 1)], earned: 0 },
    { status, lines: [line('lunch-5-wings', 3)], earned: 0 },
    { status, lines: [line('lunch-5-wings', 3), line('wings-2lb')], earned: 2 },
    { status, lines: [line('lunch-5-wings'), line('party-75-wings')], earned: 8 },
    { status, lines: [line('lunch-5-wings'), line('party-100-wings')], earned: 11 },
  ]))('confirmed lunch exclusion on $status yields $earned stamps', async ({ status, lines, earned }) => {
    const f = fixture(lines, 0, false, status); await f.run(); await f.run();
    expect(f.summary).toMatchObject({ availableStamps: Math.min(8, earned), lifetimeStamps: 20 + earned });
    expect(f.tx.customerWingsStampLedger.create).toHaveBeenCalledTimes(earned > 0 ? 1 : 0);
  });
  it.each(['PLACED', 'PREPARING', 'CANCELLED'])('does not award before a qualifying completion (%s)', async status => {
    const f = fixture([line('party-75-wings')], 0, false, status); await f.run(); expect(f.tx.customerWingsRewards.update).not.toHaveBeenCalled();
  });
  it('skips guests and non-eligible lunch orders', async () => {
    const guest = fixture([line('party-100-wings')], 0, false, 'DELIVERED', null); await guest.run();
    expect(guest.tx.customerWingsStampLedger.findFirst).not.toHaveBeenCalled();
    const lunch = fixture([line('lunch-5-wings')]); await lunch.run(); expect(lunch.tx.customerWingsRewards.update).not.toHaveBeenCalled();
  });
  it('party earning never makes a party pack redeemable, even with a forged one-pound payload', () => {
    expect(summarizeWingsInCart([{ quantity: 1, menuItemSlug: 'party-100-wings', unitPriceCents: 11699, lineTotalCents: 11699,
      builderPayload: { builder_type: 'WINGS', weight_lb: 1 } }])).toEqual({ poundsInCart: 0, cheapestPerLbCents: 0 });
  });
});

describe("sumRewardablePaidWingsPounds", () => {
  function orderLine(overrides: Partial<WingsAwardOrderLine>): WingsAwardOrderLine {
    return {
      quantity: 1,
      menuItemSlug: "wings-1lb",
      builderType: "WINGS",
      builderPayload: {
        builder_type: "WINGS",
        weight_lb: 1,
      },
      ...overrides,
    };
  }

  it("does not award stamps for lunch 5-wings even though it uses the wings builder", () => {
    const pounds = sumRewardablePaidWingsPounds([
      orderLine({
        quantity: 3,
        menuItemSlug: "lunch-5-wings",
        builderType: "WINGS",
        builderPayload: {
          builder_type: "WINGS",
          weight_lb: 1,
        },
      }),
    ]);

    expect(pounds).toBe(0);
  });

  it("awards stamps for by-the-pound wings and wing combos", () => {
    const pounds = sumRewardablePaidWingsPounds([
      orderLine({
        quantity: 2,
        menuItemSlug: "wings-1.5lb",
        builderPayload: {
          builder_type: "WINGS",
          weight_lb: 1.5,
        },
      }),
      orderLine({
        quantity: 1,
        menuItemSlug: "combo-2lb",
        builderType: "WING_COMBO",
        builderPayload: {
          builder_type: "WING_COMBO",
          weight_lb: 2,
        },
      }),
    ]);

    expect(pounds).toBe(5);
  });

  it("awards the official eight eligible pounds for a 75-wing party SKU", () => {
    const pounds = sumRewardablePaidWingsPounds([
      orderLine({
        quantity: 1,
        menuItemSlug: "party-75-wings",
        builderType: "WINGS",
        builderPayload: {
          builder_type: "WINGS",
          weight_lb: 5,
        },
      }),
    ]);

    expect(pounds).toBe(8);
  });
});
