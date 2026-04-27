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
  type ModifierOption,
  type RemovedIngredientSelection,
} from "@/lib/types";
import { normalizeSaladAddonDisplayLabel } from "@/lib/salad-catalog";
import {
  BUILDER_VALIDATION_MESSAGE,
  BuilderShell,
  builderSubmitLabel,
} from "./builder-shared";

type Props = {
  item: MenuItem;
  onClose: () => void;
  /**
   * Phase 13: pre-fill the overlay from this cart line and replace the
   * line on submit instead of adding a new one.
   */
  editingLine?: CartItem;
};

/** Three flagship burgers + five wraps — not lunch specials or side-add rows. */
const SIDE_POP_BUNDLE_SLUGS = new Set([
  "veggie-burger",
  "chicken-burger",
  "buffalo-chicken-burger",
  "veggie-wrap",
  "chicken-caesar-wrap",
  "buffalo-chicken-wrap",
  "garden-chicken-wrap",
  "greek-chicken-wrap",
]);

const SMALL_SIDE_LABELS = ["Fries", "Onion rings", "Wedges", "Coleslaw"] as const;

/** Matches `POP_OPTIONS` in packages/database/prisma/seed.ts */
const POP_LABELS = [
  "Pepsi",
  "Diet Pepsi",
  "Pepsi Zero",
  "Coke",
  "Diet Coke",
  "Coke Zero",
  "Mountain Dew",
  "Diet Mountain Dew",
] as const;

function normalizeSmallSideLabel(value: string | undefined): string {
  if (value && (SMALL_SIDE_LABELS as readonly string[]).includes(value)) {
    return value;
  }
  return SMALL_SIDE_LABELS[0];
}

function normalizePopLabel(value: string | undefined): string {
  if (value && (POP_LABELS as readonly string[]).includes(value)) {
    return value;
  }
  return POP_LABELS[0];
}

/** Strip legacy serialized bundle note; combo lives on builder_payload only. */
function getInitialSpecialInstructionsOnly(editingLine?: CartItem): string {
  return stripSidePopBundleNoteFromInstructions(editingLine?.special_instructions ?? "");
}

function initSelections(
  groups: ModifierGroup[],
  editingLine?: CartItem,
): Record<string, Set<string>> {
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

  for (const group of groups) {
    let defaults = group.options
      .filter((option) => option.is_default)
      .map((option) => option.id);
    if (
      defaults.length === 0 &&
      group.context_key === "size" &&
      group.selection_mode === "SINGLE" &&
      group.options.length === 1
    ) {
      defaults = [group.options[0].id];
    }
    map[group.id] = new Set(defaults);
  }
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

const ADDON_OPTION_STOP_WORDS = new Set([
  "add",
  "extra",
  "on",
  "the",
  "side",
  "optional",
  "with",
]);

const ALWAYS_SHOW_ADDON_TOKENS = new Set([
  "bacon",
  "avocado",
  "jalapeno",
  "jalapenos",
  "olive",
  "olives",
  "chicken",
  "beef",
  "pulled",
  "butter",
  "cheese",
  "curds",
  "gravy",
  "sauce",
  "ranch",
  "mayo",
  "dressing",
  "tzatziki",
  "feta",
]);

function normalizeIngredientText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferOptionSizeScope(
  optionName: string,
  normalizedSizeNames: string[],
): string | null {
  if (normalizedSizeNames.length === 0) return null;

  const normalizedOption = normalizeIngredientText(optionName);
  for (const sizeName of normalizedSizeNames) {
    const pattern = new RegExp(`(^|\\s)${escapeRegex(sizeName)}($|\\s)`);
    if (pattern.test(normalizedOption)) {
      return sizeName;
    }
  }

  return null;
}

function getAddonMeaningfulTokens(value: string): string[] {
  return normalizeIngredientText(value)
    .replace(/\bon the side\b/g, " ")
    .split(" ")
    .filter((token) => token && !ADDON_OPTION_STOP_WORDS.has(token));
}

function optionMatchesAnyIngredient(
  optionName: string,
  normalizedIngredientNames: string[],
  strictIngredientOnly?: boolean,
): boolean {
  if (normalizedIngredientNames.length === 0) return true;

  const normalizedOption = normalizeIngredientText(optionName).replace(
    /\bon the side\b/g,
    " ",
  ).trim();
  const tokens = getAddonMeaningfulTokens(optionName);

  if (!normalizedOption || tokens.length === 0) {
    return true;
  }

  if (
    normalizedIngredientNames.some(
      (ingredient) =>
        ingredient === normalizedOption ||
        ingredient.includes(normalizedOption) ||
        normalizedOption.includes(ingredient),
    )
  ) {
    return true;
  }

  if (
    normalizedIngredientNames.some((ingredient) =>
      tokens.every((token) => ingredient.includes(token)),
    )
  ) {
    return true;
  }

  if (strictIngredientOnly) {
    return false;
  }

  // Backward-compatible fallback: ambiguous extras that don't cleanly map to
  // a removable ingredient still stay visible unless they are explicitly scoped.
  return (
    normalizedOption.startsWith("add ") ||
    tokens.some((token) => ALWAYS_SHOW_ADDON_TOKENS.has(token))
  );
}

function isSaladMenuItemSlug(slug: string): boolean {
  return slug.endsWith("-salad");
}

/** Options like "Add fresh hand breaded chicken (Small)" — shown as one row with size-based price. */
function isBreadedChickenSizePairOption(
  optionName: string,
  normalizedSizeNames: string[],
): boolean {
  const scope = inferOptionSizeScope(optionName, normalizedSizeNames);
  if (!scope) return false;
  const n = normalizeIngredientText(optionName);
  return n.includes("breaded") && n.includes("chicken");
}

function shouldRenderAddonOption(
  option: ModifierOption,
  normalizedIngredientNames: string[],
  isSelected: boolean,
  selectedSizeNames: string[],
  normalizedSizeNames: string[],
  opts?: {
    strictSaladIngredientAddons?: boolean;
    hideBreadedChickenPair?: boolean;
  },
): boolean {
  if (opts?.hideBreadedChickenPair && isBreadedChickenSizePairOption(option.name, normalizedSizeNames)) {
    return false;
  }
  if (isSelected) return true;
  const sizeScope = inferOptionSizeScope(option.name, normalizedSizeNames);
  if (sizeScope && selectedSizeNames.length > 0) {
    return selectedSizeNames.includes(sizeScope);
  }
  if (option.addon_match_normalized) {
    return normalizedIngredientNames.includes(option.addon_match_normalized);
  }
  return optionMatchesAnyIngredient(
    option.name,
    normalizedIngredientNames,
    opts?.strictSaladIngredientAddons,
  );
}

export function ItemCustomizationOverlay({ item, onClose, editingLine }: Props) {
  const { addItem, replaceItem } = useCart();
  const [selections, setSelections] = useState(() =>
    initSelections(item.modifier_groups, editingLine),
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
    normalizeSmallSideLabel(editingItemPayload?.side_pop_bundle?.side_label),
  );
  const [sidePopPopLabel, setSidePopPopLabel] = useState(() =>
    normalizePopLabel(editingItemPayload?.side_pop_bundle?.pop_label),
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const sizeGroups = useMemo(
    () => item.modifier_groups.filter((group) => group.context_key === "size"),
    [item.modifier_groups],
  );
  const normalizedSizeNames = useMemo(
    () =>
      Array.from(
        new Set(
          sizeGroups
            .flatMap((group) => group.options)
            .map((option) => normalizeIngredientText(option.name))
            .filter(Boolean),
        ),
      ),
    [sizeGroups],
  );
  const selectedSizeNames = useMemo(
    () =>
      sizeGroups.flatMap((group) =>
        group.options
          .filter((option) => selections[group.id]?.has(option.id))
          .map((option) => normalizeIngredientText(option.name))
          .filter(Boolean),
      ),
    [selections, sizeGroups],
  );
  const normalizedIngredientNames = useMemo(
    () =>
      item.removable_ingredients
        .map((ingredient) => normalizeIngredientText(ingredient.name))
        .filter(Boolean),
    [item.removable_ingredients],
  );
  const strictSaladIngredientAddons = isSaladMenuItemSlug(item.slug);
  const addonGroups = useMemo(() => {
    return item.modifier_groups
      .filter((group) => group.context_key === "addon")
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          shouldRenderAddonOption(
            option,
            normalizedIngredientNames,
            selections[group.id]?.has(option.id) ?? false,
            selectedSizeNames,
            normalizedSizeNames,
            {
              strictSaladIngredientAddons,
              hideBreadedChickenPair: strictSaladIngredientAddons,
            },
          ),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [
    item.modifier_groups,
    normalizedIngredientNames,
    normalizedSizeNames,
    selections,
    selectedSizeNames,
    strictSaladIngredientAddons,
  ]);
  const mainGroups = useMemo(
    () =>
      item.modifier_groups.filter(
        (group) =>
          group.context_key !== "size" && group.context_key !== "addon",
      ),
    [item.modifier_groups],
  );

  const removedIngredients = useMemo<RemovedIngredientSelection[]>(() => {
    return item.removable_ingredients
      .filter((ingredient) => removedIngredientIds.has(ingredient.id))
      .map((ingredient) => ({ id: ingredient.id, name: ingredient.name }));
  }, [item.removable_ingredients, removedIngredientIds]);

  const modifierTotal = useMemo(() => {
    return item.modifier_groups.reduce((sum, group) => {
      for (const option of group.options) {
        if (selections[group.id]?.has(option.id)) {
          sum += option.price_delta_cents;
        }
      }
      return sum;
    }, 0);
  }, [item.modifier_groups, selections]);

  useEffect(() => {
    if (selectedSizeNames.length === 0 || normalizedSizeNames.length === 0) {
      return;
    }

    setSelections((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const group of item.modifier_groups) {
        if (group.context_key !== "addon") continue;

        const current = next[group.id];
        if (!current || current.size === 0) continue;

        const chickenOptions = group.options.filter((option) =>
          isBreadedChickenSizePairOption(option.name, normalizedSizeNames),
        );
        const chickenIds = new Set(chickenOptions.map((option) => option.id));

        if (strictSaladIngredientAddons && chickenOptions.length >= 2) {
          const byScope = new Map<string, ModifierOption>();
          for (const opt of chickenOptions) {
            const scope = inferOptionSizeScope(opt.name, normalizedSizeNames);
            if (scope) byScope.set(scope, opt);
          }

          const selectedChickenIds = [...current].filter((id) => chickenIds.has(id));
          if (selectedChickenIds.length > 0) {
            const selectedId = selectedChickenIds[0];
            const selectedEntry = [...byScope.entries()].find(([, o]) => o.id === selectedId);
            const selectedScope = selectedEntry?.[0];
            const targetScope = selectedSizeNames[0];
            if (
              selectedScope &&
              targetScope &&
              selectedScope !== targetScope &&
              byScope.has(targetScope)
            ) {
              const replacement = byScope.get(targetScope)!;
              const set = new Set(current);
              set.delete(selectedId);
              set.add(replacement.id);
              next[group.id] = set;
              changed = true;
              continue;
            }
          }
        }

        const filtered = new Set(
          Array.from(current).filter((optionId) => {
            const option = group.options.find((candidate) => candidate.id === optionId);
            if (!option) return false;
            const sizeScope = inferOptionSizeScope(option.name, normalizedSizeNames);
            return !sizeScope || selectedSizeNames.includes(sizeScope);
          }),
        );

        if (filtered.size !== current.size) {
          next[group.id] = filtered;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [
    item.modifier_groups,
    normalizedSizeNames,
    selectedSizeNames,
    strictSaladIngredientAddons,
  ]);

  const sidePopCents =
    sidePopEligible && sidePopBundleEnabled ? SIDE_POP_BUNDLE_PRICE_CENTS : 0;
  const unitPrice = item.base_price_cents + modifierTotal + sidePopCents;

  const toggleSelection = useCallback(
    (group: ModifierGroup, optionId: string) => {
      setSelections((prev) => {
        const next = { ...prev };
        const set = new Set(next[group.id] ?? []);

        if (group.selection_mode === "SINGLE") {
          set.clear();
          set.add(optionId);
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

  const toggleBreadedChickenForGroup = useCallback(
    (group: ModifierGroup) => {
      const chickenOptions = group.options.filter((option) =>
        isBreadedChickenSizePairOption(option.name, normalizedSizeNames),
      );
      const targetScope = selectedSizeNames[0];
      const active = targetScope
        ? chickenOptions.find(
            (option) =>
              inferOptionSizeScope(option.name, normalizedSizeNames) === targetScope,
          )
        : null;
      if (!active) return;

      setSelections((prev) => {
        const next = { ...prev };
        const set = new Set(next[group.id] ?? []);
        const chickenIds = new Set(chickenOptions.map((option) => option.id));
        const currentlyOn = set.has(active.id);
        for (const id of chickenIds) {
          set.delete(id);
        }
        if (!currentlyOn) {
          set.add(active.id);
        }
        next[group.id] = set;
        return next;
      });
    },
    [normalizedSizeNames, selectedSizeNames],
  );

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
    node.classList.add("builder-step-card-invalid");
    window.setTimeout(
      () => node.classList.remove("builder-step-card-invalid"),
      1200,
    );
  }, []);

  const validate = useCallback(() => {
    for (const group of item.modifier_groups) {
      const count = selections[group.id]?.size ?? 0;
      const max = group.max_select ?? Number.MAX_SAFE_INTEGER;
      if (count < group.min_select || count > max) {
        return group.id;
      }
    }

    if (item.requires_special_instructions && !instructions.trim()) {
      return "special-instructions";
    }

    return null;
  }, [
    instructions,
    item.modifier_groups,
    item.requires_special_instructions,
    selections,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

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
      scrollToSection(invalidSection);
      return;
    }

    const modifierSelections: CartModifierSelection[] = [];
    for (const group of item.modifier_groups) {
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
      <div
        className="item-customization-banner"
        style={
          item.image_url
            ? {
                backgroundImage: `linear-gradient(rgba(0,0,0,0.24), rgba(0,0,0,0.6)), url(${item.image_url})`,
              }
            : undefined
        }
      >
        {!item.image_url ? (
          <span className="item-customization-banner-fallback">W4U</span>
        ) : null}
      </div>

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
                  if (value) toggleSelection(group, value);
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
                    group.selection_mode === "SINGLE" ? "radio" : "checkbox";
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
              {strictSaladIngredientAddons
                ? "Additional ingredients"
                : "Add-ons"}
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
              const fullGroup = item.modifier_groups.find((g) => g.id === group.id);
              const chickenOpts =
                fullGroup?.options.filter((option) =>
                  isBreadedChickenSizePairOption(option.name, normalizedSizeNames),
                ) ?? [];
              const showSyntheticChicken =
                strictSaladIngredientAddons && chickenOpts.length >= 2 && fullGroup;
              const targetScope = selectedSizeNames[0];
              const activeChickenOption = targetScope
                ? chickenOpts.find(
                    (option) =>
                      inferOptionSizeScope(option.name, normalizedSizeNames) ===
                      targetScope,
                  )
                : null;
              const chickenChecked =
                activeChickenOption !== undefined &&
                activeChickenOption !== null &&
                (selections[group.id]?.has(activeChickenOption.id) ?? false);

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
                              group.selection_mode === "SINGLE"
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
                    {showSyntheticChicken && fullGroup ? (
                      <label className="builder-checkbox-row">
                        <input
                          type="checkbox"
                          checked={chickenChecked}
                          onChange={() => toggleBreadedChickenForGroup(fullGroup)}
                          disabled={!activeChickenOption}
                        />
                        <span>Add fresh hand breaded chicken</span>
                        {activeChickenOption ? (
                          activeChickenOption.price_delta_cents !== 0 ? (
                            <span className="price-text">
                              +{cents(activeChickenOption.price_delta_cents)}
                            </span>
                          ) : (
                            <span>Included</span>
                          )
                        ) : (
                          <span>Choose a size first</span>
                        )}
                      </label>
                    ) : null}
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
                if (on) {
                  setSidePopSideLabel((prev) => normalizeSmallSideLabel(prev));
                  setSidePopPopLabel((prev) => normalizePopLabel(prev));
                }
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
