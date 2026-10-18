"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripSidePopBundleNoteFromInstructions } from "@/lib/cart-item-utils";
import { useCart } from "@/lib/cart";
import { cents } from "@/lib/format";
import { normalizeIngredientDisplayText } from "@/lib/menu-text";
import {
  SIDE_POP_BUNDLE_PRICE_CENTS,
  type CartItem,
  type CartModifierSelection,
  type ItemCustomizationPayload,
  type MenuItem,
  type ModifierGroup,
  type RemovedIngredientSelection,
} from "@/lib/types";
import { normalizeSaladAddonDisplayLabel } from "@/lib/salad-catalog";
import {
  BUILDER_VALIDATION_MESSAGE,
  BuilderShell,
  builderSubmitLabel,
} from "./builder-shared";

import { customizationCatalog, initialCustomizationSelections, minimumSelections, validateSelections, modifierTotal as customizationTotal, SIDE_POP_BUNDLE_SLUGS, SIDE_POP_SIDES, SIDE_POP_DRINKS } from "@wings4u/customization";

type Props = {
  item: MenuItem;
  onClose: () => void;
  /**
   * Phase 13: pre-fill the overlay from this cart line and replace the
   * line on submit instead of adding a new one.
   */
  editingLine?: CartItem;
};

const SMALL_SIDE_LABELS = SIDE_POP_SIDES;
const POP_LABELS = SIDE_POP_DRINKS;

/** Strip legacy serialized bundle note; combo lives on builder_payload only. */
function getInitialSpecialInstructionsOnly(editingLine?: CartItem): string {
  return stripSidePopBundleNoteFromInstructions(editingLine?.special_instructions ?? "");
}

function initSelections(
  item: MenuItem,
  editingLine?: CartItem,
): Record<string, Set<string>> {
  const groups = item.modifier_groups;
  const map: Record<string, Set<string>> = {};

  if (editingLine) {
    // Phase 13: rebuild the selection sets from the cart line so the
    // overlay opens already showing the customer's existing picks.
    const selectedIds = new Set(
      editingLine.modifier_selections.map((modifier) => modifier.modifier_option_id),
    );
    for (const group of groups) {
      map[group.id] = new Set(
        group.options
          .filter((option) => selectedIds.has(option.id))
          .map((option) => option.id),
      );
    }
    return map;
  }

  for (const [id, defaults] of Object.entries(initialCustomizationSelections(item))) map[id] = new Set(defaults);
  return map;
}

function selectionRule(group: ModifierGroup) {
  if (!group.is_required) {
    if (group.selection_mode === "MULTI" && group.max_select) {
      return `Choose up to ${group.max_select}`;
    }
    return "Your choice";
  }

  if (group.selection_mode === "MULTI") {
    if (group.max_select && group.max_select > group.min_select) {
      return `Required - choose ${group.min_select} to ${group.max_select}`;
    }
    return `Required - choose ${group.min_select}`;
  }

  return "Required - choose 1";
}

export function ItemCustomizationOverlay({ item, onClose, editingLine }: Props) {
  const { addItem, replaceItem } = useCart();
  const [selections, setSelections] = useState(() =>
    initSelections(item, editingLine),
  );
  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<string>>(
    () => {
      // Phase 13: hydrate removed ingredients from the editing line.
      if (!editingLine) return new Set();
      const removed =
        editingLine.removed_ingredients ??
        (editingLine.builder_payload?.builder_type === "ITEM_CUSTOMIZATION"
          ? (editingLine.builder_payload as ItemCustomizationPayload).removed_ingredients
          : []) ??
        [];
      return new Set(removed.map((ingredient) => ingredient.id));
    },
  );
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [instructions, setInstructions] = useState(() =>
    getInitialSpecialInstructionsOnly(editingLine),
  );
  const sidePopEligible = SIDE_POP_BUNDLE_SLUGS.has(item.slug);
  const editingItemPayload =
    editingLine?.builder_payload?.builder_type === "ITEM_CUSTOMIZATION"
      ? (editingLine.builder_payload as ItemCustomizationPayload)
      : undefined;
  const [sidePopBundleEnabled, setSidePopBundleEnabled] = useState(
    () => sidePopEligible && Boolean(editingItemPayload?.side_pop_bundle),
  );
  const [sidePopSideLabel, setSidePopSideLabel] = useState(() =>
    editingItemPayload?.side_pop_bundle?.side_label ?? SMALL_SIDE_LABELS[0],
  );
  const [sidePopPopLabel, setSidePopPopLabel] = useState(() =>
    editingItemPayload?.side_pop_bundle?.pop_label ?? POP_LABELS[0],
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const selectionArrays = useMemo(() => Object.fromEntries(Object.entries(selections).map(([id, values]) => [id, [...values]])), [selections]);
  const catalog = useMemo(() => customizationCatalog(item, selectionArrays), [item, selectionArrays]);
  const groups = catalog.groups;
  const sizeGroups = groups.filter(group => group.context_key === "size");
  const addonGroups = groups.filter(group => group.context_key === "addon" && group.options.length > 0);
  const mainGroups = groups.filter(group => group.context_key !== "size" && group.context_key !== "addon");
  const [reviewed, setReviewed] = useState(false);
  const savedChanged = Boolean(editingLine && !reviewed && (
    editingLine.base_price_cents !== item.base_price_cents ||
    (editingItemPayload?.side_pop_bundle && (!sidePopEligible || editingItemPayload.side_pop_bundle.price_cents !== SIDE_POP_BUNDLE_PRICE_CENTS)) ||
    editingLine.modifier_selections.some(saved => !groups.some(group => group.options.some(option => option.id === saved.modifier_option_id && option.price_delta_cents === saved.price_delta_cents))) ||
    [...removedIngredientIds].some(id => !item.removable_ingredients.some(row => row.id === id))));
  const selectionError = validateSelections(groups, selectionArrays);
  const catalogError = catalog.issues.find(issue => issue.kind !== 'duplicate')?.message;
  const bundleError = sidePopBundleEnabled && (!(SMALL_SIDE_LABELS as readonly string[]).includes(sidePopSideLabel) || !(POP_LABELS as readonly string[]).includes(sidePopPopLabel))
    ? 'Review your side and pop choices.' : null;
  const reviewMessage = savedChanged || [...removedIngredientIds].some(id => !item.removable_ingredients.some(row => row.id === id)) || selectionError?.startsWith('Menu options changed') ? 'Menu options or prices changed. Review the current choices before updating your cart.' : null;
  function reviewCurrentChoices() {
    setSelections(Object.fromEntries(groups.map(group => [group.id, new Set((selectionArrays[group.id] ?? []).filter(id => group.options.some(option => option.id === id)))])));
    setRemovedIngredientIds(new Set([...removedIngredientIds].filter(id => item.removable_ingredients.some(row => row.id === id))));
    setReviewed(true);
  }

  const removedIngredients = useMemo<RemovedIngredientSelection[]>(() => {
    return item.removable_ingredients
      .filter((ingredient) => removedIngredientIds.has(ingredient.id))
      .map((ingredient) => ({ id: ingredient.id, name: ingredient.name }));
  }, [item.removable_ingredients, removedIngredientIds]);

  const modifierTotal = customizationTotal(groups, selectionArrays);

  const sidePopCents =
    sidePopEligible && sidePopBundleEnabled ? SIDE_POP_BUNDLE_PRICE_CENTS : 0;
  const unitPrice = item.base_price_cents + modifierTotal + sidePopCents;

  const toggleSelection = useCallback(
    (group: ModifierGroup, optionId: string) => {
      setSelections((prev) => {
        const next = { ...prev };
        const set = new Set(next[group.id] ?? []);

        if (group.selection_mode === "SINGLE") {
          const deselect = set.has(optionId) && minimumSelections(group) === 0;
          set.clear();
          if (!deselect && optionId) set.add(optionId);
        } else if (set.has(optionId)) {
          set.delete(optionId);
        } else {
          const max = group.max_select ?? Number.MAX_SAFE_INTEGER;
          if (set.size < max) {
            set.add(optionId);
          }
        }

        next[group.id] = set;
        return next;
      });
    },
    [],
  );

  const toggleIngredient = useCallback((ingredientId: string) => {
    setRemovedIngredientIds((prev) => {
      const next = new Set(prev);
      if (next.has(ingredientId)) {
        next.delete(ingredientId);
      } else {
        next.add(ingredientId);
      }
      return next;
    });
  }, []);

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
    node.focus({ preventScroll: true });
    node.classList.add("builder-step-card-invalid");
    window.setTimeout(
      () => node.classList.remove("builder-step-card-invalid"),
      1200,
    );
  }, []);

  const validate = useCallback(() => {
    if (catalogError || reviewMessage || selectionError || bundleError) return "catalog-review";

    if (item.requires_special_instructions && !instructions.trim()) {
      return "special-instructions";
    }

    return null;
  }, [
    instructions,
    catalogError, reviewMessage, selectionError, bundleError,
    item.requires_special_instructions,
    selections,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  // Wait for the error section to mount before scrolling and focusing it.
  useEffect(() => {
    if (submitAttempted && validationError) scrollToSection(validationError);
  }, [submitAttempted, validationError, scrollToSection]);

  // Auto-dismiss the validation banner once everything required is filled.
  useEffect(() => {
    if (submitAttempted && isReadyToSubmit) {
      setSubmitAttempted(false);
    }
  }, [submitAttempted, isReadyToSubmit]);

  function handleAdd() {
    const invalidSection = validationError;
    if (invalidSection) {
      setSubmitAttempted(true);
      if (submitAttempted) scrollToSection(invalidSection);
      return;
    }

    const modifierSelections: CartModifierSelection[] = [];
    for (const group of groups) {
      for (const option of group.options) {
        if (selections[group.id]?.has(option.id)) {
          modifierSelections.push({
            modifier_option_id: option.id,
            group_name: group.name,
            option_name: option.name,
            price_delta_cents: option.price_delta_cents,
          });
        }
      }
    }

    /** Combo upgrade is stored on `side_pop_bundle` only; not duplicated in special_instructions. */
    const mergedInstructions = instructions.trim();

    const builderPayload: ItemCustomizationPayload = {
      builder_type: "ITEM_CUSTOMIZATION",
      removed_ingredients: removedIngredients,
      ...(sidePopEligible && sidePopBundleEnabled
        ? {
            side_pop_bundle: {
              price_cents: SIDE_POP_BUNDLE_PRICE_CENTS,
              side_label: sidePopSideLabel,
              pop_label: sidePopPopLabel,
            },
          }
        : {}),
    };

    const incoming = {
      menu_item_id: item.id,
      menu_item_slug: item.slug,
      name: item.name,
      image_url: item.image_url,
      base_price_cents: item.base_price_cents,
      quantity,
      modifier_selections: modifierSelections,
      removed_ingredients: removedIngredients,
      special_instructions: mergedInstructions,
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
      closeAriaLabel="Close customization"
      quantity={quantity}
      onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
      onIncrease={() => setQuantity((value) => value + 1)}
      quantityDisabled={!isReadyToSubmit}
      totalCents={unitPrice * quantity}
      submitLabel={builderSubmitLabel(Boolean(editingLine))}
      onSubmit={handleAdd}
    >
      {catalogError || reviewMessage || bundleError || (submitAttempted && selectionError) ? (
        <section ref={node => setSectionRef('catalog-review', node)} tabIndex={-1}
          className="builder-step-card" role="alert" aria-live="assertive">
          <p>{catalogError || reviewMessage || bundleError || selectionError}</p>
          {reviewMessage ? <button type="button" onClick={reviewCurrentChoices}>Review current choices</button> : null}
        </section>
      ) : null}
      {sizeGroups.map((group) => (
        <section
          key={group.id}
          className={`builder-step-card${submitAttempted && validationError === group.id ? " builder-step-card-invalid" : ""}`}
          ref={(node) => setSectionRef(group.id, node)}
        >
          <div className="builder-step-card-head">
            <h3>{normalizeSaladAddonDisplayLabel(group.display_label, group.name)}</h3>
            <p>{selectionRule(group)}</p>
          </div>
          {submitAttempted && validationError === group.id ? (
            <div className="builder-step-inline-error" role="alert" aria-live="assertive">
              {BUILDER_VALIDATION_MESSAGE}
            </div>
          ) : null}
          <div className="builder-option-pills">
            {group.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`builder-option-pill${selections[group.id]?.has(option.id) ? " builder-option-pill-active" : ""}`}
                onClick={() => toggleSelection(group, option.id)}
              >
                {normalizeIngredientDisplayText(option.name)}
                {option.price_delta_cents !== 0 ? (
                  <>
                    {" "}
                    +<span className="price-text">{cents(option.price_delta_cents)}</span>
                  </>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}

      {item.removable_ingredients.length > 0 ? (
        <section
          className="builder-step-card"
          ref={(node) => setSectionRef("ingredients", node)}
        >
          <div className="builder-step-card-head">
            <h3>Ingredients</h3>
          </div>
          <div className="ingredient-checkbox-list">
            {item.removable_ingredients.map((ingredient) => {
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
        </section>
      ) : null}

      {mainGroups.map((group) => {
        // Long SINGLE-select pickers (e.g. each slot of the 6-pack pop, with
        // 8+ options) collapse into a native <select> dropdown so the overlay
        // doesn't end up scrolling through dozens of radio rows.
        const useDropdown =
          group.selection_mode === "SINGLE" && group.options.length > 6;
        const selectedId = selections[group.id]?.values().next().value ?? "";

        return (
          <section
            key={group.id}
            className={`builder-step-card${group.is_required ? " modifier-required-highlight" : ""}${submitAttempted && validationError === group.id ? " builder-step-card-invalid" : ""}`}
            ref={(node) => setSectionRef(group.id, node)}
          >
            <div className="builder-step-card-head">
              <h3>{normalizeSaladAddonDisplayLabel(group.display_label, group.name)}</h3>
              <p>{selectionRule(group)}</p>
            </div>
            {submitAttempted && validationError === group.id ? (
              <div className="builder-step-inline-error" role="alert" aria-live="assertive">
                {BUILDER_VALIDATION_MESSAGE}
              </div>
            ) : null}
            {useDropdown ? (
              <select
                className="builder-select"
                value={selectedId}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value || minimumSelections(group) === 0) toggleSelection(group, value);
                }}
              >
                {!group.is_required || !selectedId ? (
                  <option value="">— Select —</option>
                ) : null}
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {normalizeIngredientDisplayText(option.name)}
                    {option.price_delta_cents !== 0
                      ? ` (+${cents(option.price_delta_cents)})`
                      : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="builder-checkbox-list">
                {group.options.map((option) => {
                  const checked = selections[group.id]?.has(option.id) ?? false;
                  const type =
                    group.selection_mode === "SINGLE" && minimumSelections(group) > 0 ? "radio" : "checkbox";
                  return (
                    <label key={option.id} className="builder-checkbox-row">
                      <input
                        type={type}
                        name={`mod-${group.id}`}
                        checked={checked}
                        onChange={() => toggleSelection(group, option.id)}
                      />
                      <span>{normalizeIngredientDisplayText(option.name)}</span>
                      {option.price_delta_cents !== 0 ? (
                        <span className="price-text">+{cents(option.price_delta_cents)}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {addonGroups.length > 0 ? (
        <section
          className={`builder-step-card${submitAttempted && validationError !== null && addonGroups.some((g) => g.id === validationError) ? " builder-step-card-invalid" : ""}`}
          ref={(node) => setSectionRef("addons", node)}
        >
          <div className="builder-step-card-head">
            <h3>
              Additional ingredients
            </h3>
            <p>Add Extra items.</p>
          </div>
          {submitAttempted &&
          validationError !== null &&
          addonGroups.some((g) => g.id === validationError) ? (
            <div className="builder-step-inline-error" role="alert" aria-live="assertive">
              {BUILDER_VALIDATION_MESSAGE}
            </div>
          ) : null}
          <div className="builder-addon-group-stack">
            {addonGroups.map((group) => {
              const count = selections[group.id]?.size ?? 0;
              const max = group.max_select ?? Number.MAX_SAFE_INTEGER;
              const showGroupLabel = addonGroups.length > 1;
              return (
                <div key={group.id} className="builder-addon-group">
                  {showGroupLabel ? (
                    <div className="builder-addon-group-head">
                      <h4>{normalizeSaladAddonDisplayLabel(group.display_label, group.name)}</h4>
                      <p>{selectionRule(group)}</p>
                    </div>
                  ) : null}
                  <div className="builder-checkbox-list">
                    {group.options.map((option) => {
                      const checked =
                        selections[group.id]?.has(option.id) ?? false;
                      return (
                        <label
                          key={option.id}
                          className="builder-checkbox-row"
                      >
                          <input
                            type={
                              group.selection_mode === "SINGLE" && minimumSelections(group) > 0
                                ? "radio"
                                : "checkbox"
                            }
                            name={`mod-${group.id}`}
                            checked={checked}
                            onChange={() => toggleSelection(group, option.id)}
                            disabled={!checked && count >= max}
                          />
                          <span>{normalizeIngredientDisplayText(option.name)}</span>
                          {option.price_delta_cents !== 0 ? (
                            <span className="price-text">+{cents(option.price_delta_cents)}</span>
                          ) : null}
                        </label>
                      );
                    })}

                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {sidePopEligible ? (
        <section
          className="builder-step-card"
          ref={(node) => setSectionRef("side-pop-bundle", node)}
        >
          <div className="builder-step-card-head">
            <h3>Side + pop</h3>
            <p>Optional combo with your order.</p>
          </div>
          <label className="builder-checkbox-row">
            <input
              type="checkbox"
              checked={sidePopBundleEnabled}
              onChange={(event) => {
                const on = event.target.checked;
                setSidePopBundleEnabled(on);
              }}
            />
            <span>
              Add small side and pop for{" "}
              <span className="price-text">{cents(SIDE_POP_BUNDLE_PRICE_CENTS)}</span>
            </span>
          </label>
          {sidePopBundleEnabled ? (
            <>
              <div className="builder-step-card-head" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ fontSize: "0.95rem", margin: 0 }}>Small side</h4>
              </div>
              <div className="builder-option-pills">
                {SMALL_SIDE_LABELS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={`builder-option-pill${sidePopSideLabel === label ? " builder-option-pill-active" : ""}`}
                    onClick={() => setSidePopSideLabel(label)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="builder-checkbox-row" style={{ marginTop: "0.75rem" }}>
                <span style={{ minWidth: "2.5rem" }}>Pop</span>
                <select
                  className="builder-select"
                  style={{ flex: 1, maxWidth: "100%" }}
                  value={sidePopPopLabel}
                  onChange={(event) => setSidePopPopLabel(event.target.value)}
                >
                  {POP_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </section>
      ) : null}

      <section
        tabIndex={-1}
        className={`builder-step-card${submitAttempted && validationError === "special-instructions" ? " builder-step-card-invalid" : ""}`}
        ref={(node) => setSectionRef("special-instructions", node)}
      >
        <div className="builder-step-card-head">
          <h3>Special instructions</h3>
          <p>
            {item.requires_special_instructions
              ? "Required for this item."
              : "Notes for the kitchen."}
          </p>
        </div>
        {submitAttempted && validationError === "special-instructions" ? (
          <div className="builder-step-inline-error" role="alert" aria-live="assertive">
            {BUILDER_VALIDATION_MESSAGE}
          </div>
        ) : null}
        <textarea
          className="builder-textarea"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          maxLength={200}
          rows={4}
          placeholder="Anything we should know?"
        />
      </section>
    </BuilderShell>
  );
}
