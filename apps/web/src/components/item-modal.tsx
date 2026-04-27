"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, CartModifierSelection, ModifierGroup } from "@/lib/types";
import { useCart } from "@/lib/cart";
import { cents } from "@/lib/format";
import { normalizeIngredientDisplayText } from "@/lib/menu-text";
import { normalizeSaladAddonDisplayLabel } from "@/lib/salad-catalog";
import { BUILDER_VALIDATION_MESSAGE, BuilderShell } from "./builder-shared";

type Props = {
  item: MenuItem;
  onClose: () => void;
};

function initSelections(groups: ModifierGroup[]): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const g of groups) {
    const defaults = g.options.filter((o) => o.is_default).map((o) => o.id);
    map[g.id] = new Set(defaults);
  }
  return map;
}

export function ItemModal({ item, onClose }: Props) {
  const { addItem } = useCart();
  const [selections, setSelections] = useState(() =>
    initSelections(item.modifier_groups),
  );
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const toggle = useCallback(
    (group: ModifierGroup, optionId: string) => {
      setSelections((prev) => {
        const next = { ...prev };
        const set = new Set(next[group.id]);
        if (group.selection_mode === "SINGLE") {
          set.clear();
          set.add(optionId);
        } else {
          if (set.has(optionId)) {
            set.delete(optionId);
          } else if (set.size < (group.max_select ?? Number.MAX_SAFE_INTEGER)) {
            set.add(optionId);
          }
        }
        next[group.id] = set;
        return next;
      });
    },
    [],
  );

  const modifierTotal = item.modifier_groups.reduce((sum, g) => {
    for (const opt of g.options) {
      if (selections[g.id]?.has(opt.id)) sum += opt.price_delta_cents;
    }
    return sum;
  }, 0);

  const unitPrice = item.base_price_cents + modifierTotal;

  const validationError = useMemo(() => {
    for (const group of item.modifier_groups) {
      const count = selections[group.id]?.size ?? 0;
      if (
        count < group.min_select ||
        count > (group.max_select ?? Number.MAX_SAFE_INTEGER)
      ) {
        return group.id;
      }
    }
    return null;
  }, [item.modifier_groups, selections]);
  const valid = validationError === null;

  const sizeGroups = item.modifier_groups.filter((g) => g.context_key === "size");
  const otherGroups = item.modifier_groups.filter((g) => g.context_key !== "size");

  const setSectionRef = useCallback((key: string, node: HTMLElement | null) => {
    if (node) {
      sectionRefs.current.set(key, node);
    } else {
      sectionRefs.current.delete(key);
    }
  }, []);

  const scrollToSection = useCallback((key: string) => {
    const node = sectionRefs.current.get(key);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(() => {
    if (submitAttempted && valid) {
      setSubmitAttempted(false);
    }
  }, [submitAttempted, valid]);

  function handleAdd() {
    if (validationError) {
      setSubmitAttempted(true);
      scrollToSection(validationError);
      return;
    }

    const mods: CartModifierSelection[] = [];
    for (const g of item.modifier_groups) {
      for (const opt of g.options) {
        if (selections[g.id]?.has(opt.id)) {
          mods.push({
            modifier_option_id: opt.id,
            group_name: g.name,
            option_name: opt.name,
            price_delta_cents: opt.price_delta_cents,
          });
        }
      }
    }
    addItem({
      menu_item_id: item.id,
      menu_item_slug: item.slug,
      name: item.name,
      image_url: item.image_url,
      base_price_cents: item.base_price_cents,
      quantity,
      modifier_selections: mods,
      special_instructions: instructions.trim(),
    });
    onClose();
  }

  return (
    <BuilderShell
      title={item.name}
      description={item.description}
      onClose={onClose}
      quantity={quantity}
      onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
      onIncrease={() => setQuantity((q) => q + 1)}
      quantityDisabled={!valid}
      totalCents={unitPrice * quantity}
      submitLabel="Add to cart"
      onSubmit={handleAdd}
    >
      {sizeGroups.map((g) => (
        <section
          key={g.id}
          ref={(node) => setSectionRef(g.id, node)}
          className={`builder-step-card${submitAttempted && validationError === g.id ? " builder-step-card-invalid" : ""}`}
        >
          <div className="builder-step-card-head">
            <h3>{normalizeSaladAddonDisplayLabel(g.display_label, g.name)}</h3>
          </div>
          {submitAttempted && validationError === g.id ? (
            <div className="builder-step-inline-error" role="alert" aria-live="assertive">
              {BUILDER_VALIDATION_MESSAGE}
            </div>
          ) : null}
          <div className="builder-option-pills">
            {g.options.map((opt) => {
              const active = selections[g.id]?.has(opt.id) ?? false;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                  onClick={() => toggle(g, opt.id)}
                >
                  {normalizeIngredientDisplayText(opt.name)}
                  {opt.price_delta_cents !== 0 ? (
                    <>
                      {" "}
                      +<span className="price-text">{cents(opt.price_delta_cents)}</span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {otherGroups.map((g) => (
        <section
          key={g.id}
          ref={(node) => setSectionRef(g.id, node)}
          className={`builder-step-card${submitAttempted && validationError === g.id ? " builder-step-card-invalid" : ""}`}
        >
          <div className="builder-step-card-head">
            <h3>{normalizeSaladAddonDisplayLabel(g.display_label, g.name)}</h3>
            <p>
              {g.is_required ? "Required" : "Your choice"}
              {g.selection_mode === "SINGLE"
                ? " · pick one"
                : ` · pick ${g.min_select}\u2013${g.max_select ?? ""}`}
            </p>
          </div>
          {submitAttempted && validationError === g.id ? (
            <div className="builder-step-inline-error" role="alert" aria-live="assertive">
              {BUILDER_VALIDATION_MESSAGE}
            </div>
          ) : null}
          <div className="builder-checkbox-list">
            {g.options.map((opt) => {
              const checked = selections[g.id]?.has(opt.id) ?? false;
              const inputType = g.selection_mode === "SINGLE" ? "radio" : "checkbox";
              return (
                <label key={opt.id} className="builder-checkbox-row">
                  <input
                    type={inputType}
                    name={`mod-${g.id}`}
                    checked={checked}
                    onChange={() => toggle(g, opt.id)}
                  />
                  <span>{normalizeIngredientDisplayText(opt.name)}</span>
                  {opt.price_delta_cents !== 0 && (
                    <span className="price-text">+{cents(opt.price_delta_cents)}</span>
                  )}
                </label>
              );
            })}
          </div>
        </section>
      ))}

      <section className="builder-step-card">
        <div className="builder-step-card-head">
          <h3>Special instructions</h3>
          <p>Notes for the kitchen.</p>
        </div>
        <textarea
          className="builder-textarea"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. extra crispy"
          rows={3}
        />
      </section>
    </BuilderShell>
  );
}
