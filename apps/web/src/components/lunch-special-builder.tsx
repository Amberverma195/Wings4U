"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCart } from "@/lib/cart";
import { getCustomerVisibleInstructions } from "@/lib/cart-item-utils";
import { cents } from "@/lib/format";
import { normalizeIngredientDisplayText } from "@/lib/menu-text";
import type {
  CartItem,
  CartModifierSelection,
  LunchSpecialPayload,
  MenuItem,
  ModifierGroup,
  RemovedIngredientSelection,
} from "@/lib/types";
import {
  BUILDER_VALIDATION_MESSAGE,
  BuilderShell,
  StepContainer,
  builderSubmitLabel,
} from "./builder-shared";

type Props = {
  /** The lunch row itself (lunch-burger or lunch-wrap). */
  item: MenuItem;
  /**
   * The list of items the customer can pick from. For lunch-burger this is
   * the burgers category items (excluding the side-add helper row). For
   * lunch-wrap this is the wraps category items.
   */
  childItems: MenuItem[];
  onClose: () => void;
  editingLine?: CartItem;
};

type ChildAddonSelection = {
  modifier_option_id: string;
  name: string;
  price_delta_cents: number;
};

function getChildAddonGroups(child: MenuItem): ModifierGroup[] {
  return child.modifier_groups.filter((group) => group.context_key === "addon");
}

function getLunchPopGroup(item: MenuItem): ModifierGroup | null {
  // The lunch row carries one popTypeGroup (context_key: "drink"). Use the
  // first matching group so the seed can attach more if needed.
  return (
    item.modifier_groups.find((group) => group.context_key === "drink") ?? null
  );
}

export function LunchSpecialBuilder({
  item,
  childItems,
  onClose,
  editingLine,
}: Props) {
  const { addItem, replaceItem } = useCart();

  const editingPayload =
    editingLine?.builder_payload?.builder_type === "LUNCH_SPECIAL"
      ? (editingLine.builder_payload as LunchSpecialPayload)
      : undefined;

  const popGroup = useMemo(() => getLunchPopGroup(item), [item]);

  // Filter out side-add helper rows like "Add Side & Pop to Any Burger" so
  // the customer never sees them as a pickable child.
  const pickableChildren = useMemo(
    () =>
      childItems.filter(
        (child) =>
          !/side\s*&\s*pop/i.test(child.name) && !/-side-add$/i.test(child.slug),
      ),
    [childItems],
  );

  const [childId, setChildId] = useState<string>(
    editingPayload?.child_menu_item_id ?? "",
  );
  const selectedChild = useMemo(
    () => pickableChildren.find((child) => child.id === childId) ?? null,
    [childId, pickableChildren],
  );

  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<string>>(
    () => new Set(editingPayload?.removed_ingredients.map((r) => r.id) ?? []),
  );
  const [childAddonIds, setChildAddonIds] = useState<Set<string>>(
    () =>
      new Set(
        editingPayload?.child_addons.map((addon) => addon.modifier_option_id) ??
          [],
      ),
  );

  // Reset child-scoped picks whenever the customer switches children so we
  // never carry stale ingredient/addon ids across menu items.
  useEffect(() => {
    setRemovedIngredientIds((prev) => {
      if (!selectedChild) return prev;
      const validIds = new Set(
        selectedChild.removable_ingredients.map((r) => r.id),
      );
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
    setChildAddonIds((prev) => {
      if (!selectedChild) return prev;
      const validIds = new Set<string>();
      for (const group of getChildAddonGroups(selectedChild)) {
        for (const opt of group.options) validIds.add(opt.id);
      }
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [selectedChild]);

  const [popOptionId, setPopOptionId] = useState<string>(() => {
    if (!editingLine) return "";
    const popSel = editingLine.modifier_selections.find((sel) =>
      popGroup?.options.some((opt) => opt.id === sel.modifier_option_id),
    );
    return popSel?.modifier_option_id ?? "";
  });

  const [instructions, setInstructions] = useState(
    editingLine ? getCustomerVisibleInstructions(editingLine) : "",
  );
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const childAddonGroups = useMemo(
    () => (selectedChild ? getChildAddonGroups(selectedChild) : []),
    [selectedChild],
  );

  const childAddonsTotalDelta = useMemo(() => {
    if (!selectedChild) return 0;
    let total = 0;
    for (const group of childAddonGroups) {
      for (const opt of group.options) {
        if (childAddonIds.has(opt.id)) {
          total += opt.price_delta_cents;
        }
      }
    }
    return total;
  }, [childAddonGroups, childAddonIds, selectedChild]);

  const liveUnitPrice = item.base_price_cents + childAddonsTotalDelta;

  const validate = useCallback(() => {
    if (!selectedChild) return "child";
    if (popGroup && !popOptionId) return "pop";
    return null;
  }, [popGroup, popOptionId, selectedChild]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  useEffect(() => {
    if (submitAttempted && isReadyToSubmit) {
      setSubmitAttempted(false);
    }
  }, [submitAttempted, isReadyToSubmit]);

  function toggleIngredient(id: string) {
    setRemovedIngredientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAddon(group: ModifierGroup, id: string) {
    setChildAddonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      const max = group.max_select ?? Number.MAX_SAFE_INTEGER;
      // Count current picks within this group only.
      let count = 0;
      for (const opt of group.options) {
        if (next.has(opt.id)) count += 1;
      }
      if (count >= max) return next;
      next.add(id);
      return next;
    });
  }

  function buildSpecialInstructions(
    child: MenuItem,
    removed: RemovedIngredientSelection[],
    addons: ChildAddonSelection[],
    userInstructions: string,
  ): string {
    const lines: string[] = [];
    lines.push(`Lunch ${item.name}: ${child.name}`);
    if (removed.length > 0) {
      lines.push(`No: ${removed.map((r) => r.name).join(", ")}`);
    }
    if (addons.length > 0) {
      lines.push(`Add: ${addons.map((a) => a.name).join(", ")}`);
    }
    if (userInstructions.trim()) {
      lines.push(userInstructions.trim());
    }
    return lines.join(" | ");
  }

  function handleAdd() {
    const invalid = validationError;
    if (invalid) {
      setSubmitAttempted(true);
      return;
    }

    if (!selectedChild) return;

    const removed: RemovedIngredientSelection[] =
      selectedChild.removable_ingredients
        .filter((ingredient) => removedIngredientIds.has(ingredient.id))
        .map((ingredient) => ({ id: ingredient.id, name: ingredient.name }));

    const addons: ChildAddonSelection[] = [];
    for (const group of childAddonGroups) {
      for (const opt of group.options) {
        if (childAddonIds.has(opt.id)) {
          addons.push({
            modifier_option_id: opt.id,
            name: opt.name,
            price_delta_cents: opt.price_delta_cents,
          });
        }
      }
    }

    const modifierSelections: CartModifierSelection[] = [];
    if (popGroup) {
      const popOpt = popGroup.options.find((o) => o.id === popOptionId);
      if (popOpt) {
        modifierSelections.push({
          modifier_option_id: popOpt.id,
          group_name: popGroup.name,
          option_name: popOpt.name,
          price_delta_cents: popOpt.price_delta_cents,
        });
      }
    }

    const builderPayload: LunchSpecialPayload = {
      builder_type: "LUNCH_SPECIAL",
      child_menu_item_id: selectedChild.id,
      child_name: selectedChild.name,
      child_slug: selectedChild.slug,
      removed_ingredients: removed,
      child_addons: addons,
    };

    const incoming = {
      menu_item_id: item.id,
      menu_item_slug: item.slug,
      name: item.name,
      image_url: item.image_url,
      base_price_cents: item.base_price_cents,
      quantity,
      modifier_selections: modifierSelections,
      special_instructions: buildSpecialInstructions(
        selectedChild,
        removed,
        addons,
        instructions,
      ),
      builder_payload: builderPayload,
    };

    if (editingLine) {
      replaceItem(editingLine.key, incoming);
    } else {
      addItem(incoming);
    }
    onClose();
  }

  return (
    <BuilderShell
      title={item.name}
      description={item.description}
      onClose={onClose}
      closeAriaLabel="Close lunch special builder"
      quantity={quantity}
      onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
      onIncrease={() => setQuantity((value) => value + 1)}
      quantityDisabled={!isReadyToSubmit}
      totalCents={liveUnitPrice * quantity}
      submitLabel={builderSubmitLabel(Boolean(editingLine))}
      onSubmit={handleAdd}
    >
      <StepContainer
        title="Pick your item"
        subtitle={
          pickableChildren.length === 0
            ? "No items available right now."
            : "Choose one to customize."
        }
        invalid={submitAttempted && validationError === "child"}
        inlineError={
          submitAttempted && validationError === "child"
            ? BUILDER_VALIDATION_MESSAGE
            : null
        }
      >
        <div className="builder-option-pills">
          {pickableChildren.map((child) => (
            <button
              key={child.id}
              type="button"
              className={`builder-option-pill${childId === child.id ? " builder-option-pill-active" : ""}`}
              onClick={() => setChildId(child.id)}
            >
              {child.name}
            </button>
          ))}
        </div>
      </StepContainer>

      {selectedChild && selectedChild.removable_ingredients.length > 0 ? (
        <StepContainer title="Ingredients">
          <div className="ingredient-checkbox-list">
            {selectedChild.removable_ingredients.map((ingredient) => {
              const removed = removedIngredientIds.has(ingredient.id);
              const checked = !removed;
              const ingredientLabel = normalizeIngredientDisplayText(ingredient.name);
              return (
                <label
                  key={ingredient.id}
                  className={`ingredient-checkbox-row${removed ? " ingredient-checkbox-row-removed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleIngredient(ingredient.id)}
                    aria-label={
                      removed
                        ? `Add ${ingredientLabel} back`
                        : `Remove ${ingredientLabel}`
                    }
                  />
                  <span className="ingredient-checkbox-name">
                    {ingredientLabel}
                  </span>
                </label>
              );
            })}
          </div>
        </StepContainer>
      ) : null}

      {selectedChild && childAddonGroups.length > 0 ? (
        <StepContainer
          title="Add extras"
          subtitle="Paid add-ons. The price updates as you pick."
        >
          <div className="builder-addon-group-stack">
                {childAddonGroups.map((group) => (
                  <div key={group.id} className="builder-addon-group">
                    <div className="builder-checkbox-list">
                      {group.options.map((opt) => {
                        const checked = childAddonIds.has(opt.id);
                        const optionLabel = normalizeIngredientDisplayText(opt.name);
                        return (
                          <label key={opt.id} className="builder-checkbox-row">
                            <input
                          type="checkbox"
                              checked={checked}
                              onChange={() => toggleAddon(group, opt.id)}
                            />
                            <span>{optionLabel}</span>
                            {opt.price_delta_cents !== 0 ? (
                              <span className="price-text">+{cents(opt.price_delta_cents)}</span>
                            ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </StepContainer>
      ) : null}

      {popGroup ? (
        <StepContainer
          title={popGroup.display_label || popGroup.name}
          subtitle="Pick your pop."
          invalid={submitAttempted && validationError === "pop"}
          inlineError={
            submitAttempted && validationError === "pop"
              ? BUILDER_VALIDATION_MESSAGE
              : null
          }
        >
            <div className="builder-option-pills">
              {popGroup.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`builder-option-pill${popOptionId === opt.id ? " builder-option-pill-active" : ""}`}
                  onClick={() => setPopOptionId(opt.id)}
                >
                  {normalizeIngredientDisplayText(opt.name)}
                </button>
              ))}
            </div>
        </StepContainer>
      ) : null}

      <StepContainer title="Special instructions">
        <textarea
          className="builder-textarea"
          rows={4}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Anything we should know?"
        />
      </StepContainer>
    </BuilderShell>
  );
}
