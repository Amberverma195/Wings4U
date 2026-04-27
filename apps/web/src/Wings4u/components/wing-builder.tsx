"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import { apiJson } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents } from "@/lib/format";
import type {
  MenuItem,
  ModifierGroup,
  CartModifierSelection,
  WingFlavour,
  WingBuilderPayload,
} from "@/lib/types";

type Props = {
  item: MenuItem;
  onClose: () => void;
};

type FlavourSlot = {
  slotNo: number;
  flavourId: string;
  flavourName: string;
  placement: "ON_WINGS";
};

type ExtraFlavour = {
  enabled: boolean;
  flavourId: string;
  flavourName: string;
  placement: "ON_WINGS";
};

type WingType = "BONE_IN" | "BONELESS";
type Preparation = "BREADED" | "NON_BREADED";

const HEAT_ORDER = ["PLAIN", "MILD", "MEDIUM", "HOT", "DRY_RUB"] as const;

const SAUCING_METHODS: { label: string; value: string }[] = [
  { label: "Half & Half", value: "HALF_AND_HALF" },
  { label: "Mixed", value: "MIXED" },
  { label: "Side", value: "SIDE" },
  { label: "Split Evenly", value: "SPLIT_EVENLY" },
  { label: "All Mixed", value: "ALL_MIXED" },
];

const SAUCING_THREE_EXTRA = {
  label: "Two Mixed, One Side",
  value: "TWO_MIXED_ONE_SIDE",
};

const EXTRA_FLAVOUR_CENTS = 100;

function parseWeightFromName(name: string): number {
  const partyMatch = name.match(/(\d+)\s*Wings/i);
  if (partyMatch) {
    const count = parseInt(partyMatch[1], 10);
    if (count >= 100) return 7.0;
    if (count >= 75) return 5.0;
    return count / 15;
  }
  const lbMatch = name.match(/([\d.]+)\s*Pound/i);
  if (lbMatch) return parseFloat(lbMatch[1]);
  return 1.0;
}

function parseMaxFlavours(item: MenuItem): number {
  const text = `${item.name} ${item.description ?? ""}`;
  if (/75\s*Wings/i.test(text) || /100\s*Wings/i.test(text)) return 5;
  const m = text.match(/(\d+)\s*Flavours?/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

function isPartySpecialItem(name: string): boolean {
  return /75\s*Wings/i.test(name) || /100\s*Wings/i.test(name);
}

function findGroupByContextOrName(
  groups: ModifierGroup[],
  contextTest: (ck: string) => boolean,
  nameTest: (n: string) => boolean,
): ModifierGroup | undefined {
  return (
    groups.find((g) => g.context_key && contextTest(g.context_key)) ??
    groups.find((g) => nameTest(g.name))
  );
}

export function WingBuilder({ item, onClose }: Props) {
  const { addItem } = useCart();

  const [flavours, setFlavours] = useState<WingFlavour[]>([]);
  const [flavoursLoading, setFlavoursLoading] = useState(true);

  const [wingType, setWingType] = useState<WingType>("BONE_IN");
  const [preparation, setPreparation] = useState<Preparation>("BREADED");
  const [flavourSlots, setFlavourSlots] = useState<FlavourSlot[]>([]);
  const [saucingMethod, setSaucingMethod] = useState<string | null>(null);
  const [extraFlavour, setExtraFlavour] = useState<ExtraFlavour>({
    enabled: false,
    flavourId: "",
    flavourName: "",
    placement: "ON_WINGS",
  });
  const [sideSelections, setSideSelections] = useState<string[]>([]);
  const [drinkSelections, setDrinkSelections] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [quantity, setQuantity] = useState(1);

  const stepRefs = useRef<Map<string, HTMLElement>>(new Map());

  const isCombo = item.builder_type === "WING_COMBO";
  const maxFlavours = useMemo(() => parseMaxFlavours(item), [item]);
  const isPartySpecial = useMemo(() => isPartySpecialItem(item.name), [item.name]);

  const wingTypeGroup = useMemo(
    () =>
      findGroupByContextOrName(
        item.modifier_groups,
        (ck) => /wing/i.test(ck) && /type/i.test(ck),
        (n) => n === "Wing Type",
      ),
    [item.modifier_groups],
  );

  const sideGroups = useMemo(
    () =>
      item.modifier_groups.filter(
        (g) =>
          (g.context_key && /side/i.test(g.context_key)) ||
          /side/i.test(g.name),
      ),
    [item.modifier_groups],
  );

  const drinkGroups = useMemo(
    () =>
      item.modifier_groups.filter(
        (g) =>
          (g.context_key && /(drink|pop|beverage)/i.test(g.context_key)) ||
          /(drink|pop|beverage)/i.test(g.name),
      ),
    [item.modifier_groups],
  );

  useEffect(() => {
    setFlavourSlots(
      Array.from({ length: maxFlavours }, (_, i) => ({
        slotNo: i + 1,
        flavourId: "",
        flavourName: "",
        placement: "ON_WINGS" as const,
      })),
    );
  }, [maxFlavours]);

  useEffect(() => {
    if (isCombo) {
      setSideSelections(Array(sideGroups.length).fill(""));
      setDrinkSelections(Array(drinkGroups.length).fill(""));
    }
  }, [isCombo, sideGroups.length, drinkGroups.length]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const env = await apiJson<WingFlavour[]>(
          `/api/v1/menu/wing-flavours?location_id=${DEFAULT_LOCATION_ID}`,
        );
        if (!cancelled && env.data) setFlavours(env.data);
      } catch {
        // Flavours failed to load — user will see "Loading flavours…" indefinitely
      } finally {
        if (!cancelled) setFlavoursLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (wingType === "BONELESS") setPreparation("NON_BREADED");
  }, [wingType]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const groupedFlavours = useMemo(() => {
    const map = new Map<string, WingFlavour[]>();
    for (const f of flavours) {
      const level = f.is_plain ? "PLAIN" : f.heat_level;
      if (!map.has(level)) map.set(level, []);
      map.get(level)!.push(f);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    const ordered: { level: string; items: WingFlavour[] }[] = [];
    for (const level of HEAT_ORDER) {
      const items = map.get(level);
      if (items?.length) ordered.push({ level, items });
    }
    for (const [level, items] of map) {
      if (!HEAT_ORDER.includes(level as (typeof HEAT_ORDER)[number])) {
        ordered.push({ level, items });
      }
    }
    return ordered;
  }, [flavours]);

  const filledFlavourCount = useMemo(
    () => flavourSlots.filter((s) => s.flavourId).length,
    [flavourSlots],
  );

  const setSlotFlavour = useCallback(
    (index: number, flavour: WingFlavour) => {
      setFlavourSlots((prev) =>
        prev.map((s, i) =>
          i === index
            ? { ...s, flavourId: flavour.id, flavourName: flavour.name }
            : s,
        ),
      );
    },
    [],
  );

  const modifierTotal = useMemo(() => {
    let total = 0;
    if (extraFlavour.enabled) total += EXTRA_FLAVOUR_CENTS;
    if (isCombo) {
      for (let i = 0; i < sideGroups.length; i++) {
        const optId = sideSelections[i];
        if (optId) {
          const opt = sideGroups[i].options.find((o) => o.id === optId);
          if (opt) total += opt.price_delta_cents;
        }
      }
      for (let i = 0; i < drinkGroups.length; i++) {
        const optId = drinkSelections[i];
        if (optId) {
          const opt = drinkGroups[i].options.find((o) => o.id === optId);
          if (opt) total += opt.price_delta_cents;
        }
      }
    }
    return total;
  }, [extraFlavour.enabled, isCombo, sideGroups, drinkGroups, sideSelections, drinkSelections]);

  const unitPrice = item.base_price_cents + modifierTotal;

  const validate = useCallback((): string | null => {
    if (!wingType) return "wing-type";
    for (let i = 0; i < flavourSlots.length; i++) {
      if (!flavourSlots[i].flavourId) return `flavour-${i}`;
    }
    if (filledFlavourCount >= 2 && !isPartySpecial && !saucingMethod) return "saucing";
    if (extraFlavour.enabled && !extraFlavour.flavourId) return "extra-flavour";
    if (isCombo && !isPartySpecial) {
      for (let i = 0; i < sideGroups.length; i++) {
        if (!sideSelections[i]) return `side-${i}`;
      }
      for (let i = 0; i < drinkGroups.length; i++) {
        if (!drinkSelections[i]) return `drink-${i}`;
      }
    }
    return null;
  }, [
    wingType,
    flavourSlots,
    filledFlavourCount,
    isPartySpecial,
    saucingMethod,
    extraFlavour,
    isCombo,
    sideGroups,
    drinkGroups,
    sideSelections,
    drinkSelections,
  ]);

  const scrollToStep = useCallback((key: string) => {
    const el = stepRefs.current.get(key);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth" });
    el.classList.add("wk-step-error");
    setTimeout(() => el.classList.remove("wk-step-error"), 1200);
  }, []);

  const handleAdd = useCallback(() => {
    const failedStep = validate();
    if (failedStep) {
      scrollToStep(failedStep);
      return;
    }

    const mods: CartModifierSelection[] = [];

    if (wingTypeGroup) {
      const optName = wingType === "BONE_IN" ? "Bone-In" : "Boneless";
      const opt = wingTypeGroup.options.find(
        (o) => o.name.toLowerCase().replace(/[\s-]/g, "") === optName.toLowerCase().replace(/[\s-]/g, ""),
      );
      if (opt) {
        mods.push({
          modifier_option_id: opt.id,
          group_name: wingTypeGroup.name,
          option_name: opt.name,
          price_delta_cents: opt.price_delta_cents,
        });
      }
    }

    if (isCombo) {
      for (let i = 0; i < sideGroups.length; i++) {
        const optId = sideSelections[i];
        if (!optId) continue;
        const group = sideGroups[i];
        const opt = group.options.find((o) => o.id === optId);
        if (opt) {
          mods.push({
            modifier_option_id: opt.id,
            group_name: group.name,
            option_name: opt.name,
            price_delta_cents: opt.price_delta_cents,
          });
        }
      }
      for (let i = 0; i < drinkGroups.length; i++) {
        const optId = drinkSelections[i];
        if (!optId) continue;
        const group = drinkGroups[i];
        const opt = group.options.find((o) => o.id === optId);
        if (opt) {
          mods.push({
            modifier_option_id: opt.id,
            group_name: group.name,
            option_name: opt.name,
            price_delta_cents: opt.price_delta_cents,
          });
        }
      }
    }

    const builderPayload: WingBuilderPayload = {
      builder_type: isCombo ? "WING_COMBO" : "WINGS",
      wing_type: wingType,
      preparation,
      weight_lb: parseWeightFromName(item.name),
      flavour_slots: flavourSlots
        .filter((s) => s.flavourId)
        .map((s, i) => ({
          slot_no: i + 1,
          wing_flavour_id: s.flavourId,
          flavour_name: s.flavourName,
          placement: s.placement,
        })),
      saucing_method: saucingMethod ?? undefined,
      extra_flavour: extraFlavour.enabled
        ? {
            wing_flavour_id: extraFlavour.flavourId,
            flavour_name: extraFlavour.flavourName,
            placement: extraFlavour.placement,
          }
        : undefined,
      side_selections: isCombo ? sideSelections : undefined,
      drink_selections: isCombo ? drinkSelections : undefined,
    };

    addItem({
      menu_item_id: item.id,
      menu_item_slug: item.slug,
      name: item.name,
      base_price_cents: item.base_price_cents,
      image_url: item.image_url,
      quantity,
      modifier_selections: mods,
      special_instructions: specialInstructions.trim(),
      builder_payload: builderPayload,
    });
    onClose();
  }, [
    validate,
    scrollToStep,
    wingTypeGroup,
    wingType,
    preparation,
    isCombo,
    sideGroups,
    drinkGroups,
    sideSelections,
    drinkSelections,
    flavourSlots,
    saucingMethod,
    extraFlavour,
    item,
    quantity,
    specialInstructions,
    addItem,
    onClose,
  ]);

  const saucingOptions = useMemo(() => {
    const opts = [...SAUCING_METHODS];
    if (filledFlavourCount >= 3) opts.push(SAUCING_THREE_EXTRA);
    return opts;
  }, [filledFlavourCount]);

  const setStepRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) stepRefs.current.set(key, el);
    else stepRefs.current.delete(key);
  }, []);

  const renderFlavourPicker = (
    selectedId: string,
    onSelect: (f: WingFlavour) => void,
  ) => {
    if (flavoursLoading) {
      return <p className="wk-builder-loading">Loading flavours…</p>;
    }
    return (
      <div className="wk-flavour-groups">
        {groupedFlavours.map(({ level, items }) => (
          <div key={level} className="wk-flavour-group">
            <span className="wk-heat-label">{level.replace(/_/g, " ")}</span>
            <div className="wk-pill-row">
              {items.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`wk-pill${f.id === selectedId ? " wk-pill-active" : ""}`}
                  onClick={() => onSelect(f)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="wk-builder-overlay" onClick={onClose}>
      <div className="wk-builder-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wk-builder-header">
          <h2>{item.name}</h2>
          <button type="button" className="wk-builder-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="wk-builder-body">
          {/* Step 1: Wing Type */}
          <section
            className="wk-builder-step"
            ref={(el) => setStepRef("wing-type", el)}
          >
            <h3>Wing Type</h3>
            <div className="wk-pill-row">
              <button
                type="button"
                className={`wk-pill${wingType === "BONE_IN" ? " wk-pill-active" : ""}`}
                onClick={() => setWingType("BONE_IN")}
              >
                Bone-In
              </button>
              <button
                type="button"
                className={`wk-pill${wingType === "BONELESS" ? " wk-pill-active" : ""}`}
                onClick={() => setWingType("BONELESS")}
              >
                Boneless
              </button>
            </div>
          </section>

          {/* Step 2: Preparation */}
          <section
            className="wk-builder-step"
            ref={(el) => setStepRef("preparation", el)}
          >
            <h3>Preparation</h3>
            <div className="wk-pill-row">
              <button
                type="button"
                className={`wk-pill${preparation === "BREADED" ? " wk-pill-active" : ""}${wingType === "BONELESS" ? " wk-pill-disabled" : ""}`}
                disabled={wingType === "BONELESS"}
                onClick={() => setPreparation("BREADED")}
              >
                Breaded
              </button>
              <button
                type="button"
                className={`wk-pill${preparation === "NON_BREADED" ? " wk-pill-active" : ""}`}
                onClick={() => setPreparation("NON_BREADED")}
              >
                Non-Breaded
              </button>
            </div>
          </section>

          {/* Step 3: Size (locked) */}
          <section className="wk-builder-step">
            <h3>Size</h3>
            <span className="wk-size-badge">{item.name}</span>
          </section>

          {/* Step 4: Flavour Slots */}
          {flavourSlots.map((slot, idx) => (
            <section
              key={slot.slotNo}
              className="wk-builder-step"
              ref={(el) => setStepRef(`flavour-${idx}`, el)}
            >
              <h3>
                {maxFlavours === 1 ? "Flavour" : `Flavour ${slot.slotNo}`}
              </h3>
              {renderFlavourPicker(slot.flavourId, (f) =>
                setSlotFlavour(idx, f),
              )}
            </section>
          ))}

          {/* Step 5: Saucing Method */}
          {filledFlavourCount >= 2 && !isPartySpecial && (
            <section
              className="wk-builder-step"
              ref={(el) => setStepRef("saucing", el)}
            >
              <h3>Saucing Method</h3>
              <div className="wk-pill-row">
                {saucingOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`wk-pill${saucingMethod === opt.value ? " wk-pill-active" : ""}`}
                    onClick={() => setSaucingMethod(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Step 6: Extra Flavour */}
          <section
            className="wk-builder-step"
            ref={(el) => setStepRef("extra-flavour", el)}
          >
            <h3>Extra Flavour</h3>
            <label className="wk-toggle-label">
              <input
                type="checkbox"
                checked={extraFlavour.enabled}
                onChange={(e) =>
                  setExtraFlavour((prev) => ({
                    ...prev,
                    enabled: e.target.checked,
                    ...(e.target.checked
                      ? {}
                      : { flavourId: "", flavourName: "" }),
                  }))
                }
              />
              <span>Add extra flavour +$1.00</span>
            </label>
            {extraFlavour.enabled &&
              renderFlavourPicker(extraFlavour.flavourId, (f) =>
                setExtraFlavour((prev) => ({
                  ...prev,
                  flavourId: f.id,
                  flavourName: f.name,
                })),
              )}
          </section>

          {/* Step 7: Combo Extras */}
          {isCombo &&
            !isPartySpecial &&
            sideGroups.map((group, gi) => (
              <section
                key={group.id}
                className="wk-builder-step"
                ref={(el) => setStepRef(`side-${gi}`, el)}
              >
                <h3>{group.display_label || group.name}</h3>
                <div className="wk-pill-row">
                  {group.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`wk-pill${sideSelections[gi] === opt.id ? " wk-pill-active" : ""}`}
                      onClick={() =>
                        setSideSelections((prev) => {
                          const next = [...prev];
                          next[gi] = opt.id;
                          return next;
                        })
                      }
                    >
                      {opt.name}
                      {opt.price_delta_cents !== 0 && (
                        <span className="wk-pill-price">
                          {" "}
                          +{cents(opt.price_delta_cents)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}

          {isCombo &&
            !isPartySpecial &&
            drinkGroups.map((group, gi) => (
              <section
                key={group.id}
                className="wk-builder-step"
                ref={(el) => setStepRef(`drink-${gi}`, el)}
              >
                <h3>{group.display_label || group.name}</h3>
                <div className="wk-pill-row">
                  {group.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`wk-pill${drinkSelections[gi] === opt.id ? " wk-pill-active" : ""}`}
                      onClick={() =>
                        setDrinkSelections((prev) => {
                          const next = [...prev];
                          next[gi] = opt.id;
                          return next;
                        })
                      }
                    >
                      {opt.name}
                      {opt.price_delta_cents !== 0 && (
                        <span className="wk-pill-price">
                          {" "}
                          +{cents(opt.price_delta_cents)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}

          {/* Step 8: Special Instructions */}
          <section className="wk-builder-step">
            <h3>Special Instructions</h3>
            <textarea
              className="wk-builder-textarea"
              placeholder="Any special requests?"
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              rows={3}
            />
          </section>
        </div>

        {/* Sticky bottom bar */}
        <div className="wk-builder-footer">
          <div className="wk-builder-qty">
            <button
              type="button"
              className="wk-builder-qty-btn"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <span className="wk-builder-qty-count">{quantity}</span>
            <button
              type="button"
              className="wk-builder-qty-btn"
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="wk-builder-add-btn"
            onClick={handleAdd}
          >
            Add to Cart ·{" "}
            <span className="builder-submit-total">{cents(unitPrice * quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
