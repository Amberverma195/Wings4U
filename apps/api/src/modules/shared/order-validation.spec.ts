import { UnprocessableEntityException } from "@nestjs/common";
import {
  assertBuilderPayloadValid,
  type ValidationMenuItem,
} from "./order-validation";
import {
  getBuilderPriceDelta,
  getLunchAddonOptionIds,
  SIDE_POP_BUNDLE_PRICE_CENTS,
  BONELESS_WINGS_UPCHARGE_CENTS,
  EXTRA_FLAVOUR_PRICE_CENTS,
} from "./pricing";

describe("Order Validation & Pricing Security Hardening", () => {
  const baseWingItem: ValidationMenuItem = {
    id: "item-wings-1lb",
    name: "1 LB Traditional Wings",
    slug: "wings-1lb",
    builderType: "WINGS",
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  const specialWingItem: ValidationMenuItem = {
    id: "item-wings-special",
    name: "Wings-4-U Special",
    slug: "wings-4u-special",
    builderType: "WINGS",
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  const comboItem: ValidationMenuItem = {
    id: "item-combo-1",
    name: "Single Wing Combo",
    slug: "single-wing-combo",
    builderType: "WING_COMBO",
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  const burgerItem: ValidationMenuItem = {
    id: "item-burger",
    name: "Veggie Burger",
    slug: "veggie-burger",
    builderType: null,
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  const drinkItem: ValidationMenuItem = {
    id: "item-coke",
    name: "Coke Can",
    slug: "coke-can",
    builderType: null,
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  const lunchItem: ValidationMenuItem = {
    id: "item-lunch-burger",
    name: "Lunch Burger Special",
    slug: "lunch-burger",
    builderType: null,
    isAvailable: true,
    archivedAt: null,
    allowedFulfillmentType: "BOTH",
    requiresSpecialInstructions: false,
    schedules: [],
    modifierGroups: [],
  };

  describe("assertBuilderPayloadValid", () => {
    it("allows valid WINGS payload", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: baseWingItem,
          builderPayload: {
            builder_type: "WINGS",
            wing_type: "BONE_IN",
            preparation: "BREADED",
            flavour_slots: [{ slot_no: 1, wing_flavour_id: "fixture", placement: "ON_WINGS" }],
          },
        }),
      ).not.toThrow();
    });

    it("rejects invalid builder type string", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: baseWingItem,
          builderPayload: {
            builder_type: "HACKED_BUILDER",
          },
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it("rejects WINGS builder on non-wings menu item", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: comboItem,
          builderPayload: {
            builder_type: "WINGS",
            wing_type: "BONE_IN",
          },
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it("rejects WING_COMBO builder on non-combo menu item", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: baseWingItem,
          builderPayload: {
            builder_type: "WING_COMBO",
            wing_type: "BONE_IN",
          },
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it("rejects boneless wings with non-breaded preparation", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: baseWingItem,
          builderPayload: {
            builder_type: "WINGS",
            wing_type: "BONELESS",
            preparation: "NON_BREADED",
          },
        }),
      ).toThrow("Boneless wings cannot be non-breaded");

      expect(() =>
        assertBuilderPayloadValid({
          menuItem: comboItem,
          builderPayload: {
            builder_type: "WING_COMBO",
            wing_type: "BONELESS",
            preparation: "NON_BREADED",
          },
        }),
      ).toThrow("Boneless wings cannot be non-breaded");
    });

    it("rejects salad_customization on regular wings that are not Wings-4-U Special", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: baseWingItem,
          builderPayload: {
            builder_type: "WINGS",
            salad_customization: {
              salad_menu_item_id: "salad-1",
            },
          },
        }),
      ).toThrow("Salad customization is only available for Wings-4-U Special");
    });

    it("allows complete salad_customization on Wings-4-U Special", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: specialWingItem,
          builderPayload: {
            builder_type: "WINGS",
            wing_type: "BONE_IN", preparation: "BREADED",
            flavour_slots: [{ slot_no: 1, wing_flavour_id: "fixture", placement: "ON_WINGS" }],
            salad_customization: {
              salad_menu_item_id: "salad-1",
            },
          },
        }),
      ).not.toThrow();
    });

    it("rejects salad_customization on wing combos", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: comboItem,
          builderPayload: {
            builder_type: "WING_COMBO",
            salad_customization: {
              salad_menu_item_id: "salad-1",
            },
          },
        }),
      ).toThrow("Salad customization is not valid for wing combos");
    });

    it("allows side_pop_bundle on eligible burger/wrap slugs", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: burgerItem,
          builderPayload: {
            builder_type: "ITEM_CUSTOMIZATION",
            side_pop_bundle: {
              side_label: "Fries",
              pop_label: "Coke",
            },
          },
        }),
      ).not.toThrow();
    });

    it("rejects side_pop_bundle on ineligible menu items", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: drinkItem,
          builderPayload: {
            builder_type: "ITEM_CUSTOMIZATION",
            side_pop_bundle: {
              side_label: "Fries",
              pop_label: "Coke",
            },
          },
        }),
      ).toThrow("Side and pop combo is not available for Coke Can");
    });

    it("rejects LUNCH_SPECIAL on non-lunch menu item", () => {
      expect(() =>
        assertBuilderPayloadValid({
          menuItem: burgerItem,
          builderPayload: {
            builder_type: "LUNCH_SPECIAL",
          },
        }),
      ).toThrow("is not a lunch special");
    });

    it("rejects LUNCH_SPECIAL with inactive or missing child_addons", () => {
      const optionMap = new Map([
        ["opt-active", { id: "opt-active", isActive: true, priceDeltaCents: 150 }],
        ["opt-inactive", { id: "opt-inactive", isActive: false, priceDeltaCents: 150 }],
      ]);

      expect(() =>
        assertBuilderPayloadValid({
          menuItem: lunchItem,
          builderPayload: {
            builder_type: "LUNCH_SPECIAL",
            child_addons: [{ modifier_option_id: "opt-inactive" }],
          },
          optionMap,
        }),
      ).toThrow('Add-on option "opt-inactive" is no longer available');

      expect(() =>
        assertBuilderPayloadValid({
          menuItem: lunchItem,
          builderPayload: {
            builder_type: "LUNCH_SPECIAL",
            child_addons: [{ modifier_option_id: "opt-ghost" }],
          },
          optionMap,
        }),
      ).toThrow('Add-on option "opt-ghost" is no longer available');
    });

    it("rejects LUNCH_SPECIAL with duplicate child_addons", () => {
      const optionMap = new Map([
        ["opt-cheese", { id: "opt-cheese", isActive: true, priceDeltaCents: 150 }],
      ]);

      expect(() =>
        assertBuilderPayloadValid({
          menuItem: lunchItem,
          builderPayload: {
            builder_type: "LUNCH_SPECIAL",
            child_addons: [
              { modifier_option_id: "opt-cheese" },
              { modifier_option_id: "opt-cheese" },
            ],
          },
          optionMap,
        }),
      ).toThrow('Duplicate add-on option "opt-cheese" is not allowed');
    });
  });

  describe("getBuilderPriceDelta Security & Parity", () => {
    it("returns 0 for missing or empty builder payload", () => {
      expect(getBuilderPriceDelta(undefined)).toBe(0);
      expect(getBuilderPriceDelta({})).toBe(0);
    });

    it("calculates WINGS upcharges correctly", () => {
      expect(
        getBuilderPriceDelta({
          builder_type: "WINGS",
          wing_type: "BONE_IN",
        }),
      ).toBe(0);

      expect(
        getBuilderPriceDelta({
          builder_type: "WINGS",
          wing_type: "BONELESS",
        }),
      ).toBe(BONELESS_WINGS_UPCHARGE_CENTS);

      expect(
        getBuilderPriceDelta({
          builder_type: "WINGS",
          wing_type: "BONE_IN",
          extra_flavour: { wing_flavour_id: "sauce-1" },
        }),
      ).toBe(EXTRA_FLAVOUR_PRICE_CENTS);

      expect(
        getBuilderPriceDelta({
          builder_type: "WINGS",
          wing_type: "BONELESS",
          extra_flavour: { wing_flavour_id: "sauce-1" },
        }),
      ).toBe(BONELESS_WINGS_UPCHARGE_CENTS + EXTRA_FLAVOUR_PRICE_CENTS);
    });

    it("enforces authoritative SIDE_POP_BUNDLE_PRICE_CENTS ignoring client price manipulation", () => {
      // Attacker attempts negative price manipulation
      expect(
        getBuilderPriceDelta({
          builder_type: "ITEM_CUSTOMIZATION",
          side_pop_bundle: {
            price_cents: -50000,
            side_label: "Fries",
            pop_label: "Coke",
          },
        }),
      ).toBe(SIDE_POP_BUNDLE_PRICE_CENTS);

      // Attacker attempts zero price manipulation
      expect(
        getBuilderPriceDelta({
          builder_type: "ITEM_CUSTOMIZATION",
          side_pop_bundle: {
            price_cents: 0,
            side_label: "Fries",
            pop_label: "Coke",
          },
        }),
      ).toBe(SIDE_POP_BUNDLE_PRICE_CENTS);

      // Normal price
      expect(
        getBuilderPriceDelta({
          builder_type: "ITEM_CUSTOMIZATION",
          side_pop_bundle: {
            price_cents: 499,
            side_label: "Fries",
            pop_label: "Coke",
          },
        }),
      ).toBe(499);
    });

    it("uses authoritative DB prices for LUNCH_SPECIAL child_addons", () => {
      const optionMap = new Map([
        ["opt-cheese", { priceDeltaCents: 150 }],
        ["opt-bacon", { priceDeltaCents: 200 }],
      ]);

      // Attacker attempts to send $0 or negative price_delta_cents in payload
      const tamperedPayload = {
        builder_type: "LUNCH_SPECIAL",
        child_addons: [
          { modifier_option_id: "opt-cheese", price_delta_cents: 0 },
          { modifier_option_id: "opt-bacon", price_delta_cents: -999 },
        ],
      };

      // When optionMap is provided, authoritative DB prices (150 + 200 = 350) are enforced
      expect(getBuilderPriceDelta(tamperedPayload, optionMap)).toBe(350);

      // Missing catalogue pricing must fail closed
      expect(() => getBuilderPriceDelta(tamperedPayload)).toThrow(UnprocessableEntityException);
    });
  });

  describe("getLunchAddonOptionIds", () => {
    it("extracts option IDs from LUNCH_SPECIAL", () => {
      expect(
        getLunchAddonOptionIds({
          builder_type: "LUNCH_SPECIAL",
          child_addons: [
            { modifier_option_id: "opt-1" },
            { modifier_option_id: "opt-2" },
          ],
        }),
      ).toEqual(["opt-1", "opt-2"]);
    });

    it("returns empty array for non-lunch builders", () => {
      expect(getLunchAddonOptionIds({ builder_type: "WINGS" })).toEqual([]);
      expect(getLunchAddonOptionIds(undefined)).toEqual([]);
    });
  });
});
