"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import {
  BONELESS_WINGS_UPCHARGE_CENTS,
  EXTRA_FLAVOUR_PRICE_CENTS,
} from "@/lib/cart-item-utils";
import { menuCardDescriptionForItem } from "@/lib/menu-item-description";
import { normalizeIngredientDisplayText } from "@/lib/menu-text";
import {
  WINGS_SPECIAL_SALAD_SIZE_LABEL,
  findSaladMenuItemForSelection,
  normalizeSaladAddonDisplayLabel,
  saladItemSupportsSize,
} from "@/lib/salad-catalog";
import type {
  BuilderMenuOption,
  CartItem,
  CartModifierSelection,
  MenuItem,
  ModifierGroup,
  RemovedIngredientSelection,
  WingFlavour,
  WingBuilderPayload,
} from "@/lib/types";
import {
  BUILDER_VALIDATION_MESSAGE,
  BuilderShell,
  builderSubmitLabel,
  ExtraFlavourPicker,
  ExtraFlavourPrice,
  FlavourPicker,
  SaucingMethodPicker,
  StepContainer,
  areAllSelectedFlavoursPlain,
  countEffectiveSaucedFlavours,
  defaultSaucingMethodForCount,
  isFlavourWithoutSauce,
  isSaucingMethodValidForCount,
  methodRequiresSideFlavourPick,
  resolveSaucingPlacements,
  useWingFlavours,
} from "./builder-shared";

type Props = {
  item: MenuItem;
  onClose: () => void;
  saladMenuItems?: MenuItem[];
  /**
   * Phase 13: when set, the builder pre-fills its state from this cart line
   * and replaces the line on submit instead of appending a new one.
   */
  editingLine?: CartItem;
};

type WingType = "BONE_IN" | "BONELESS" | null;
type Preparation = "BREADED" | "NON_BREADED" | null;
type WingPreparationOptionId =
  | "BREADED_BONE_IN"
  | "NON_BREADED_BONE_IN"
  | "BREADED_BONELESS";

const WING_PREPARATION_OPTIONS: Array<{
  id: WingPreparationOptionId;
  label: string;
  wingType: Exclude<WingType, null>;
  preparation: Exclude<Preparation, null>;
  priceNote?: string;
}> = [
  {
    id: "BREADED_BONE_IN",
    label: "Breaded - Bone-In",
    wingType: "BONE_IN",
    preparation: "BREADED",
  },
  {
    id: "NON_BREADED_BONE_IN",
    label: "Non-Breaded Bone-In",
    wingType: "BONE_IN",
    preparation: "NON_BREADED",
  },
  {
    id: "BREADED_BONELESS",
    label: "Breaded-Boneless",
    wingType: "BONELESS",
    preparation: "BREADED",
    priceNote: `+$${(BONELESS_WINGS_UPCHARGE_CENTS / 100).toFixed(2)}`,
  },
];

function normalizeInitialPreparation(
  wingType: WingType,
  preparation: Preparation,
): Preparation {
  return wingType === "BONELESS" ? "BREADED" : preparation;
}

function selectedWingPreparationId(
  wingType: WingType,
  preparation: Preparation,
): WingPreparationOptionId | null {
  const option = WING_PREPARATION_OPTIONS.find(
    (candidate) =>
      candidate.wingType === wingType && candidate.preparation === preparation,
  );
  return option?.id ?? null;
}

function countFlavourGroups(groups: ModifierGroup[]) {
  return groups.filter((group) =>
    group.options.some((option) => option.linked_flavour_id),
  ).length;
}

function extractWeightLb(name: string) {
  const match = name.match(/([\d.]+)\s*pound/i);
  if (!match) return 1;
  const value = Number.parseFloat(match[1] ?? "1");
  return Number.isFinite(value) ? value : 1;
}

/** Fixed wing weight when the menu name does not include “X pound” (e.g. specials). */
function builderWeightLbForItem(item: MenuItem): number {
  if (item.slug === "wings-4u-special") return 2;
  return extractWeightLb(item.name);
}

function buildFallbackWeightOption(item: MenuItem): BuilderMenuOption {
  return {
    menu_item_id: item.id,
    name: item.name,
    slug: item.slug,
    description: menuCardDescriptionForItem(item),
    base_price_cents: item.base_price_cents,
    weight_lb: builderWeightLbForItem(item),
    flavour_count: countFlavourGroups(item.modifier_groups),
    side_slot_count: 0,
    drink_slot_count: 0,
    modifier_groups: item.modifier_groups,
  };
}

function findWingTypeGroup(option: BuilderMenuOption) {
  return option.modifier_groups.find(
    (group) =>
      /wing type/i.test(group.name) || /wing type/i.test(group.display_label),
  );
}

/**
 * Returns the modifier groups attached to a wings option that aren't part
 * of the core wings flow (wing type, flavour slots, addons, sizes).
 *
 * These are rendered as generic single/multi-select steps so a wings item
 * can carry side-questions like "Choose your pop" (lunch-5-wings) or
 * "Choose your salad" (Wings-4-U Special) without per-slug special-casing.
 * Paid add-on groups (context_key "addon") are included so extras show up
 * the same way as on the customization overlay.
 */
function getExtraModifierGroups(option: BuilderMenuOption): ModifierGroup[] {
  const wingTypeGroup = findWingTypeGroup(option);
  return option.modifier_groups
    .filter((group) => {
      if (wingTypeGroup && group.id === wingTypeGroup.id) return false;
      // Flavour slots — identified by linked_flavour_id on options.
      if (group.options.some((opt) => opt.linked_flavour_id)) return false;
      // Sizes are handled by the weight option picker.
      if (group.context_key === "size") return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order);
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
  "oil",
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
): boolean {
  if (normalizedIngredientNames.length === 0) return true;

  const normalizedOption = normalizeIngredientText(optionName)
    .replace(/\bon the side\b/g, " ")
    .trim();
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

  return (
    normalizedOption.startsWith("add ") ||
    tokens.some((token) => ALWAYS_SHOW_ADDON_TOKENS.has(token))
  );
}

function shouldRenderAddonOption(params: {
  optionName: string;
  addonMatchNormalized?: string | null;
  normalizedIngredientNames: string[];
  isSelected: boolean;
  normalizedSizeNames: string[];
  selectedSizeNames: string[];
}): boolean {
  if (params.isSelected) return true;

  const sizeScope = inferOptionSizeScope(
    params.optionName,
    params.normalizedSizeNames,
  );
  if (sizeScope && params.selectedSizeNames.length > 0) {
    return params.selectedSizeNames.includes(sizeScope);
  }

  if (params.addonMatchNormalized) {
    return params.normalizedIngredientNames.includes(params.addonMatchNormalized);
  }

  return optionMatchesAnyIngredient(
    params.optionName,
    params.normalizedIngredientNames,
  );
}

function resolveWingTypeModifier(
  option: BuilderMenuOption,
  wingType: Exclude<WingType, null>,
  preparation: Exclude<Preparation, null>,
): CartModifierSelection | null {
  const group = findWingTypeGroup(option);
  if (!group) return null;

  const target =
    wingType === "BONELESS"
      ? ["boneless"]
      : preparation === "BREADED"
        ? ["breaded", "bone"]
        : ["non", "breaded", "bone"];

  const selected =
    group.options.find((optionItem) => {
      const normalized = optionItem.name.toLowerCase();
      if (wingType === "BONELESS") {
        return normalized.includes("boneless");
      }
      if (preparation === "BREADED") {
        return (
          normalized.includes("breaded") &&
          normalized.includes("bone") &&
          !normalized.includes("non")
        );
      }
      return (
        normalized.includes("non") &&
        normalized.includes("breaded") &&
        normalized.includes("bone")
      );
    }) ??
    group.options.find((optionItem) =>
      target.every((token) => optionItem.name.toLowerCase().includes(token)),
    );

  if (!selected) return null;

  return {
    modifier_option_id: selected.id,
    group_name: group.name,
    option_name: selected.name,
    price_delta_cents: selected.price_delta_cents,
  };
}

export function WingsBuilder({
  item,
  onClose,
  editingLine,
  saladMenuItems = [],
}: Props) {
  const { addItem, replaceItem } = useCart();
  const { flavours, loading, error } = useWingFlavours();
  // Phase 13: hydrate initial state from the editing payload when present.
  const editingPayload =
    editingLine?.builder_payload?.builder_type === "WINGS"
      ? (editingLine.builder_payload as WingBuilderPayload)
      : undefined;
  const editingSaladCustomization = editingPayload?.salad_customization;
  const usesChildSaladCustomization = item.slug === "wings-4u-special";
  const partyFiveSpecial =
    item.slug === "party-75-wings" || item.slug === "party-100-wings";
  /** Standalone wings-by-the-pound SKUs (no dip / extra sauce add-ons). */
  const wingsByThePoundFlow =
    item.slug === "wings-by-the-pound" ||
    /^wings-(?:\d+(?:\.\d+)?)lb$/.test(item.slug);
  const [selectedWeightId, setSelectedWeightId] = useState<string | null>(
    editingLine?.menu_item_id ?? null,
  );
  const initialWingType = editingPayload?.wing_type ?? null;
  const [wingType, setWingType] = useState<WingType>(
    initialWingType,
  );
  const [preparation, setPreparation] = useState<Preparation>(
    normalizeInitialPreparation(initialWingType, editingPayload?.preparation ?? null),
  );
  const [flavourSelections, setFlavourSelections] = useState<string[]>(
    () => editingPayload?.flavour_slots.map((slot) => slot.wing_flavour_id) ?? [],
  );
  const [saucingMethod, setSaucingMethod] = useState<string | null>(
    editingPayload?.saucing_method ?? null,
  );
  const [sideFlavourSlot, setSideFlavourSlot] = useState<number | null>(
    editingPayload?.side_flavour_slot_no ?? null,
  );
  const [extraFlavourEnabled, setExtraFlavourEnabled] = useState(
    Boolean(editingPayload?.extra_flavour),
  );
  const [extraFlavourId, setExtraFlavourId] = useState(
    editingPayload?.extra_flavour?.wing_flavour_id ?? "",
  );
  const [extraPlacement, setExtraPlacement] = useState<"ON_WINGS" | "ON_SIDE">(
    editingPayload?.extra_flavour?.placement === "ON_SIDE" ? "ON_SIDE" : "ON_WINGS",
  );
  const [instructions, setInstructions] = useState(() => {
    const raw = editingLine?.special_instructions ?? "";
    const note = editingPayload?.saucing_customer_note?.trim();
    if (!note || !raw) return raw;
    const head = `Saucing: ${note}`;
    if (raw === head) return "";
    if (raw.startsWith(`${head}\n\n`)) return raw.slice(head.length + 2);
    if (raw.startsWith(`${head}\n`)) return raw.slice(head.length + 1).trim();
    if (raw.startsWith(head)) return raw.slice(head.length).trim();
    return raw;
  });
  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<string>>(() => {
    const fromLine = editingLine?.removed_ingredients;
    if (fromLine?.length) {
      return new Set(fromLine.map((r) => r.id));
    }
    return new Set();
  });
  const [saladRemovedIngredientIds, setSaladRemovedIngredientIds] = useState<Set<string>>(
    () =>
      new Set(
        editingSaladCustomization?.removed_ingredients.map((ingredient) => ingredient.id) ??
          [],
      ),
  );
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  // Selections for the generic "extra" steps (pop slot, salad slot, etc).
  // Record<groupId, optionId[]>. Hydrated from editingLine after the
  // selectedOption (and therefore the extra group list) is known.
  const [extraGroupSelections, setExtraGroupSelections] = useState<Record<string, string[]>>({});
  const [saladModifierSelections, setSaladModifierSelections] = useState<
    Record<string, string[]>
  >({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const stepRefs = useRef(new Map<string, HTMLElement>());
  const previousSaladItemIdRef = useRef<string | null>(null);

  const weightOptions = useMemo(
    () =>
      item.weight_options?.length
        ? item.weight_options
        : [buildFallbackWeightOption(item)],
    [item],
  );

  const selectedOption = useMemo(
    () =>
      weightOptions.find((option) => option.menu_item_id === selectedWeightId) ??
      null,
    [selectedWeightId, weightOptions],
  );
  const extraGroups = useMemo(() => {
    if (!selectedOption) return [];
    const groups = getExtraModifierGroups(selectedOption);
    if (partyFiveSpecial || wingsByThePoundFlow || usesChildSaladCustomization) {
      return groups.filter((group) => group.context_key !== "addon");
    }
    return groups;
  }, [selectedOption, partyFiveSpecial, usesChildSaladCustomization, wingsByThePoundFlow]);
  /** Wings-4-U Special: drink slots render after salad + removals + salad extras. */
  const extraGroupsMinusSalad = useMemo(
    () =>
      usesChildSaladCustomization
        ? extraGroups.filter((group) => group.context_key !== "salad")
        : extraGroups,
    [extraGroups, usesChildSaladCustomization],
  );
  const selectedSaladGroup = useMemo(
    () => {
      const group = extraGroups.find((candidate) => candidate.context_key === "salad") ?? null;
      if (!group || !usesChildSaladCustomization) return group;

      return {
        ...group,
        options: group.options.filter((option) => {
          const saladItem = findSaladMenuItemForSelection(saladMenuItems, option.name);
          return saladItem
            ? saladItemSupportsSize(saladItem, WINGS_SPECIAL_SALAD_SIZE_LABEL)
            : false;
        }),
      };
    },
    [extraGroups, saladMenuItems, usesChildSaladCustomization],
  );
  const saladPickerPicks = useMemo(
    () =>
      selectedSaladGroup
        ? extraGroupSelections[selectedSaladGroup.id] ?? []
        : [],
    [extraGroupSelections, selectedSaladGroup],
  );
  const selectedSaladOption = useMemo(() => {
    if (!selectedSaladGroup) return null;
    const selectedId = extraGroupSelections[selectedSaladGroup.id]?.[0];
    return (
      selectedSaladGroup.options.find((option) => option.id === selectedId) ?? null
    );
  }, [extraGroupSelections, selectedSaladGroup]);
  const resolvedSaladItem = useMemo(() => {
    if (!usesChildSaladCustomization) return null;
    if (selectedSaladOption) {
      return findSaladMenuItemForSelection(saladMenuItems, selectedSaladOption.name);
    }
    if (!editingSaladCustomization) return null;
    const editingSaladItem =
      saladMenuItems.find(
        (saladItem) => saladItem.id === editingSaladCustomization.salad_menu_item_id,
      ) ?? null;
    return editingSaladItem &&
      saladItemSupportsSize(editingSaladItem, WINGS_SPECIAL_SALAD_SIZE_LABEL)
      ? editingSaladItem
      : null;
  }, [
    editingSaladCustomization,
    saladMenuItems,
    selectedSaladOption,
    usesChildSaladCustomization,
  ]);
  const activeRemovableIngredients = useMemo(
    () =>
      usesChildSaladCustomization
        ? resolvedSaladItem?.removable_ingredients ?? []
        : item.removable_ingredients,
    [item.removable_ingredients, resolvedSaladItem, usesChildSaladCustomization],
  );
  const normalizedSaladIngredientNames = useMemo(
    () =>
      resolvedSaladItem?.removable_ingredients
        .map((ingredient) => normalizeIngredientText(ingredient.name))
        .filter(Boolean) ?? [],
    [resolvedSaladItem],
  );
  const normalizedSaladSizeNames = useMemo(
    () =>
      Array.from(
        new Set(
          resolvedSaladItem?.modifier_groups
            .filter((group) => group.context_key === "size")
            .flatMap((group) => group.options)
            .map((option) => normalizeIngredientText(option.name))
            .filter(Boolean) ?? [],
        ),
      ),
    [resolvedSaladItem],
  );
  const selectedSaladSizeNames = useMemo(
    () =>
      normalizedSaladSizeNames.length > 0
        ? [normalizeIngredientText(WINGS_SPECIAL_SALAD_SIZE_LABEL)]
        : [],
    [normalizedSaladSizeNames],
  );
  const saladAddonGroups = useMemo(() => {
    if (!resolvedSaladItem) return [];

    return resolvedSaladItem.modifier_groups
      .filter((group) => group.context_key === "addon")
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          shouldRenderAddonOption({
            optionName: option.name,
            addonMatchNormalized: option.addon_match_normalized,
            normalizedIngredientNames: normalizedSaladIngredientNames,
            isSelected:
              saladModifierSelections[group.id]?.includes(option.id) ?? false,
            normalizedSizeNames: normalizedSaladSizeNames,
            selectedSizeNames: selectedSaladSizeNames,
          }),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [
    normalizedSaladIngredientNames,
    normalizedSaladSizeNames,
    resolvedSaladItem,
    saladModifierSelections,
    selectedSaladSizeNames,
  ]);
  const activeRemovedIngredientIds = usesChildSaladCustomization
    ? saladRemovedIngredientIds
    : removedIngredientIds;

  // Hydrate extra-group selections from the editing line once the extra
  // group list is known. Run only when selectedOption changes so we don't
  // overwrite user picks while they interact with the builder.
  useEffect(() => {
    if (!editingLine || extraGroups.length === 0) return;
    const validIds = new Set<string>();
    for (const group of extraGroups) {
      for (const opt of group.options) validIds.add(opt.id);
    }
    const next: Record<string, string[]> = {};
    for (const group of extraGroups) {
      const picks = editingLine.modifier_selections
        .filter((sel) =>
          group.options.some((opt) => opt.id === sel.modifier_option_id),
        )
        .map((sel) => sel.modifier_option_id)
        .filter((id): id is string => Boolean(id));
      if (picks.length > 0) next[group.id] = picks;
    }
    setExtraGroupSelections((prev) => {
      // Only set if we actually have hydrated data and prev is empty.
      if (Object.keys(prev).length > 0) return prev;
      return next;
    });
    // We intentionally only run this when the selectedOption (and thus the
    // extra-group list identity) changes — re-running on every edit would
    // clobber the user's in-progress picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOption]);

  useEffect(() => {
    if (!usesChildSaladCustomization) return;

    const nextSaladItemId = resolvedSaladItem?.id ?? null;
    if (!nextSaladItemId) {
      previousSaladItemIdRef.current = null;
      setSaladRemovedIngredientIds(new Set());
      setSaladModifierSelections({});
      return;
    }

    if (
      editingLine &&
      editingSaladCustomization &&
      previousSaladItemIdRef.current === null &&
      nextSaladItemId === editingSaladCustomization.salad_menu_item_id
    ) {
      const nextSelections: Record<string, string[]> = {};
      for (const group of resolvedSaladItem?.modifier_groups ?? []) {
        const picks = editingSaladCustomization.modifier_selections
          .filter((selection) =>
            group.options.some(
              (option) => option.id === selection.modifier_option_id,
            ),
          )
          .map((selection) => selection.modifier_option_id);
        if (picks.length > 0) {
          nextSelections[group.id] = picks;
        }
      }
      setSaladRemovedIngredientIds(
        new Set(
          editingSaladCustomization.removed_ingredients.map(
            (ingredient) => ingredient.id,
          ),
        ),
      );
      setSaladModifierSelections(nextSelections);
      previousSaladItemIdRef.current = nextSaladItemId;
      return;
    }

    if (previousSaladItemIdRef.current !== nextSaladItemId) {
      setSaladRemovedIngredientIds(new Set());
      setSaladModifierSelections({});
      previousSaladItemIdRef.current = nextSaladItemId;
    }
  }, [
    editingLine,
    editingSaladCustomization,
    resolvedSaladItem,
    usesChildSaladCustomization,
  ]);

  useEffect(() => {
    if (!selectedSaladGroup) return;

    const validOptionIds = new Set(selectedSaladGroup.options.map((option) => option.id));
    setExtraGroupSelections((prev) => {
      const current = prev[selectedSaladGroup.id];
      if (!current?.length) return prev;

      const filtered = current.filter((optionId) => validOptionIds.has(optionId));
      if (filtered.length === current.length) return prev;

      return {
        ...prev,
        [selectedSaladGroup.id]: filtered,
      };
    });
  }, [selectedSaladGroup]);

  useEffect(() => {
    if (!resolvedSaladItem || selectedSaladSizeNames.length === 0) {
      return;
    }

    setSaladModifierSelections((prev) => {
      let changed = false;
      const next: Record<string, string[]> = { ...prev };

      for (const group of resolvedSaladItem.modifier_groups) {
        if (group.context_key !== "addon") continue;
        const picks = prev[group.id] ?? [];
        const filtered = picks.filter((optionId) => {
          const option = group.options.find((candidate) => candidate.id === optionId);
          if (!option) return false;
          const sizeScope = inferOptionSizeScope(
            option.name,
            normalizedSaladSizeNames,
          );
          return !sizeScope || selectedSaladSizeNames.includes(sizeScope);
        });
        if (filtered.length !== picks.length) {
          next[group.id] = filtered;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [normalizedSaladSizeNames, resolvedSaladItem, selectedSaladSizeNames]);

  const requiredFlavourCount = selectedOption?.flavour_count ?? 0;
  const threeFlavourTellUsHow = requiredFlavourCount === 3;
  const tellUsHowSaucing = partyFiveSpecial || threeFlavourTellUsHow;
  // Hide the "Pound size" step entirely when the item has only one weight
  // option — i.e. party specials and any standalone single-SKU wings item.
  // Showing a single non-interactive pill there confused customers and
  // misreported the weight (Issue 5).
  const showWeightStep = weightOptions.length > 1;

  useEffect(() => {
    if (!selectedWeightId && weightOptions.length === 1) {
      setSelectedWeightId(weightOptions[0].menu_item_id);
    }
  }, [selectedWeightId, weightOptions]);

  useEffect(() => {
    setFlavourSelections((prev) =>
      Array.from(
        { length: requiredFlavourCount },
        (_, index) => prev[index] ?? "",
      ),
    );
  }, [requiredFlavourCount]);

  const flavourMap = useMemo(
    () => new Map(flavours.map((flavour) => [flavour.id, flavour])),
    [flavours],
  );

  const allMainFlavoursPlain = useMemo(
    () => areAllSelectedFlavoursPlain(flavourSelections, flavourMap),
    [flavourSelections, flavourMap],
  );
  const effectiveSaucedCount = useMemo(
    () => countEffectiveSaucedFlavours(flavourSelections, flavourMap),
    [flavourSelections, flavourMap],
  );
  const sideFlavourOptions = useMemo(
    () =>
      flavourSelections.flatMap((id, index) => {
        if (!id) return [];
        const flavour = flavourMap.get(id);
        if (!flavour || isFlavourWithoutSauce(flavour)) return [];
        return [{ slotNo: index + 1, label: flavour.name }];
      }),
    [flavourMap, flavourSelections],
  );
  const hasValidSideFlavourSlot = useMemo(
    () =>
      sideFlavourSlot !== null &&
      sideFlavourOptions.some((option) => option.slotNo === sideFlavourSlot),
    [sideFlavourOptions, sideFlavourSlot],
  );

  // Pre-select the PRD-default saucing method when the effective sauce count
  // changes, and clear the side-flavour sub-question if it no longer applies.
  useEffect(() => {
    setSaucingMethod((prev) => {
      if (
        isSaucingMethodValidForCount(
          effectiveSaucedCount,
          prev,
          partyFiveSpecial,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
      ) {
        return prev;
      }
      return defaultSaucingMethodForCount(
        effectiveSaucedCount,
        partyFiveSpecial,
        requiredFlavourCount,
        threeFlavourTellUsHow,
      );
    });
  }, [
    effectiveSaucedCount,
    partyFiveSpecial,
    requiredFlavourCount,
    threeFlavourTellUsHow,
  ]);

  useEffect(() => {
    if (!methodRequiresSideFlavourPick(effectiveSaucedCount, saucingMethod)) {
      setSideFlavourSlot(null);
    } else {
      setSideFlavourSlot((prev) =>
        prev && sideFlavourOptions.some((option) => option.slotNo === prev)
          ? prev
          : null,
      );
    }
  }, [effectiveSaucedCount, saucingMethod, sideFlavourOptions]);

  useEffect(() => {
    if (!extraFlavourEnabled || !extraFlavourId) return;
    const picked = flavours.find((f) => f.id === extraFlavourId);
    if (picked?.is_plain) {
      setExtraFlavourId("");
    }
  }, [extraFlavourEnabled, extraFlavourId, flavours]);

  const resolvedPreparation = preparation;
  const extraGroupsTotalDelta = useMemo(() => {
    let total = 0;
    for (const group of extraGroups) {
      const picks = extraGroupSelections[group.id] ?? [];
      for (const id of picks) {
        const opt = group.options.find((o) => o.id === id);
        if (opt) total += opt.price_delta_cents;
      }
    }
    return total;
  }, [extraGroups, extraGroupSelections]);
  const saladAddonsTotalDelta = useMemo(() => {
    if (!resolvedSaladItem) return 0;

    let total = 0;
    for (const group of resolvedSaladItem.modifier_groups) {
      if (group.context_key !== "addon") continue;
      const picks = saladModifierSelections[group.id] ?? [];
      for (const optionId of picks) {
        const option = group.options.find((candidate) => candidate.id === optionId);
        if (option) {
          total += option.price_delta_cents;
        }
      }
    }
    return total;
  }, [resolvedSaladItem, saladModifierSelections]);
  const liveUnitPrice =
    (selectedOption?.base_price_cents ?? 0) +
    (extraFlavourEnabled ? EXTRA_FLAVOUR_PRICE_CENTS : 0) +
    (wingType === "BONELESS" ? BONELESS_WINGS_UPCHARGE_CENTS : 0) +
    extraGroupsTotalDelta +
    saladAddonsTotalDelta;
  const showsSaucingStep = requiredFlavourCount >= 1 && !allMainFlavoursPlain;

  const isExtraGroupComplete = useCallback(
    (group: ModifierGroup) => {
      const picks = extraGroupSelections[group.id] ?? [];
      const min = group.is_required ? Math.max(group.min_select, 1) : group.min_select;
      return picks.length >= min;
    },
    [extraGroupSelections],
  );

  const toggleExtraOption = useCallback(
    (group: ModifierGroup, optionId: string) => {
      setExtraGroupSelections((prev) => {
        const current = prev[group.id] ?? [];
        if (group.selection_mode === "SINGLE") {
          return { ...prev, [group.id]: [optionId] };
        }
        if (current.includes(optionId)) {
          return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
        }
        if (group.max_select && current.length >= group.max_select) {
          // Max reached — replace the oldest pick to keep things forgiving.
          return { ...prev, [group.id]: [...current.slice(1), optionId] };
        }
        return { ...prev, [group.id]: [...current, optionId] };
      });
    },
    [],
  );
  const toggleSaladAddonOption = useCallback(
    (group: ModifierGroup, optionId: string) => {
      setSaladModifierSelections((prev) => {
        const current = prev[group.id] ?? [];
        if (group.selection_mode === "SINGLE") {
          return { ...prev, [group.id]: [optionId] };
        }
        if (current.includes(optionId)) {
          return {
            ...prev,
            [group.id]: current.filter((id) => id !== optionId),
          };
        }
        if (group.max_select && current.length >= group.max_select) {
          return { ...prev, [group.id]: [...current.slice(1), optionId] };
        }
        return { ...prev, [group.id]: [...current, optionId] };
      });
    },
    [],
  );

  const steps = useMemo(() => {
    const completion = [
      ...(showWeightStep
        ? [{ id: "quantity", label: "Pound size", complete: selectedOption !== null }]
        : []),
      {
        id: "preparation",
        label: "Wing Preparation",
        complete: wingType !== null && preparation !== null,
      },
      {
        id: "flavours",
        label: "Flavours",
        complete: requiredFlavourCount > 0 && flavourSelections.every(Boolean),
      },
      ...(showsSaucingStep
        ? [
            {
              id: "saucing",
              label: "Saucing",
              complete:
                isSaucingMethodValidForCount(
                  effectiveSaucedCount,
                  saucingMethod,
                  partyFiveSpecial,
                  requiredFlavourCount,
                  threeFlavourTellUsHow,
                ) &&
                (!methodRequiresSideFlavourPick(
                  effectiveSaucedCount,
                  saucingMethod,
                ) ||
                  hasValidSideFlavourSlot),
            },
          ]
        : []),
      {
        id: "extra-flavour",
        label: "Extra flavour",
        complete: !extraFlavourEnabled || extraFlavourId !== "",
      },
      ...(usesChildSaladCustomization
        ? [
            ...(selectedSaladGroup
              ? [
                  {
                    id: `extra-${selectedSaladGroup.id}`,
                    label: selectedSaladGroup.display_label || selectedSaladGroup.name,
                    complete: isExtraGroupComplete(selectedSaladGroup),
                  },
                ]
              : []),
            ...(activeRemovableIngredients.length > 0
              ? [
                  {
                    id: "ingredient-removals",
                    label: "Salad removals",
                    complete: true,
                  },
                ]
              : []),
            ...(saladAddonGroups.length > 0
              ? [{ id: "salad-addons", label: "Additional ingredients", complete: true }]
              : []),
            ...extraGroupsMinusSalad.map((group) => ({
              id: `extra-${group.id}`,
              label: group.display_label || group.name,
              complete: isExtraGroupComplete(group),
            })),
          ]
        : [
            ...extraGroups.map((group) => ({
              id: `extra-${group.id}`,
              label: group.display_label || group.name,
              complete: isExtraGroupComplete(group),
            })),
            ...(activeRemovableIngredients.length > 0
              ? [
                  {
                    id: "ingredient-removals",
                    label: "Salad / removals",
                    complete: true,
                  },
                ]
              : []),
            ...(saladAddonGroups.length > 0
              ? [{ id: "salad-addons", label: "Additional ingredients", complete: true }]
              : []),
          ]),
      { id: "instructions", label: "Instructions", complete: true },
    ];

    const firstIncomplete = completion.find((step) => !step.complete)?.id;
    return completion.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.complete
        ? ("complete" as const)
        : firstIncomplete === step.id
          ? ("active" as const)
          : ("pending" as const),
    }));
  }, [
    extraFlavourEnabled,
    extraFlavourId,
    activeRemovableIngredients.length,
    extraGroups,
    extraGroupsMinusSalad,
    flavourSelections,
    effectiveSaucedCount,
    hasValidSideFlavourSlot,
    isExtraGroupComplete,
    partyFiveSpecial,
    preparation,
    requiredFlavourCount,
    saladAddonGroups.length,
    saucingMethod,
    selectedOption,
    selectedSaladGroup,
    showsSaucingStep,
    showWeightStep,
    sideFlavourSlot,
    usesChildSaladCustomization,
    wingType,
    threeFlavourTellUsHow,
  ]);

  const setStepRef = useCallback((key: string, node: HTMLElement | null) => {
    if (node) {
      stepRefs.current.set(key, node);
    } else {
      stepRefs.current.delete(key);
    }
  }, []);

  const scrollToStep = useCallback((key: string) => {
    const node = stepRefs.current.get(key);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleSaucingMethodChange = useCallback(
    (value: string) => {
      setSaucingMethod(value);
      if (tellUsHowSaucing && value === "TELL_US_HOW") {
        requestAnimationFrame(() => scrollToStep("instructions"));
      }
    },
    [scrollToStep, tellUsHowSaucing],
  );

  const validate = useCallback(() => {
    if (!selectedOption) return "quantity";
    if (!wingType || !resolvedPreparation) return "preparation";
    if (flavourSelections.some((selection) => !selection)) return "flavours";
    if (!allMainFlavoursPlain) {
      if (
        !isSaucingMethodValidForCount(
          effectiveSaucedCount,
          saucingMethod,
          partyFiveSpecial,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
      ) {
        return requiredFlavourCount >= 1 ? "saucing" : null;
      }
      if (
        methodRequiresSideFlavourPick(effectiveSaucedCount, saucingMethod) &&
        !hasValidSideFlavourSlot
      ) {
        return "saucing";
      }
    }
    if (
      tellUsHowSaucing &&
      saucingMethod === "TELL_US_HOW" &&
      !instructions.trim()
    ) {
      return "instructions";
    }
    if (extraFlavourEnabled && !extraFlavourId) return "extra-flavour";
    for (const group of extraGroups) {
      if (!isExtraGroupComplete(group)) return `extra-${group.id}`;
    }
    if (
      usesChildSaladCustomization &&
      selectedSaladGroup &&
      (extraGroupSelections[selectedSaladGroup.id]?.length ?? 0) > 0 &&
      !resolvedSaladItem
    ) {
      return `extra-${selectedSaladGroup.id}`;
    }
    return null;
  }, [
    allMainFlavoursPlain,
    extraFlavourEnabled,
    extraFlavourId,
    extraGroups,
    extraGroupSelections,
    flavourSelections,
    effectiveSaucedCount,
    hasValidSideFlavourSlot,
    isExtraGroupComplete,
    requiredFlavourCount,
    resolvedSaladItem,
    instructions,
    partyFiveSpecial,
    resolvedPreparation,
    saucingMethod,
    selectedOption,
    selectedSaladGroup,
    sideFlavourSlot,
    usesChildSaladCustomization,
    wingType,
    tellUsHowSaucing,
    threeFlavourTellUsHow,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  // Auto-dismiss the validation banner once the user has fixed every issue.
  useEffect(() => {
    if (submitAttempted && isReadyToSubmit) {
      setSubmitAttempted(false);
    }
  }, [submitAttempted, isReadyToSubmit]);

  function handleAdd() {
    const invalidStep = validationError;
    if (invalidStep) {
      setSubmitAttempted(true);
      scrollToStep(invalidStep);
      return;
    }

    if (!selectedOption || !wingType || !resolvedPreparation) {
      return;
    }

    const resolvedSaucingMethod = allMainFlavoursPlain
      ? null
      : isSaucingMethodValidForCount(
          effectiveSaucedCount,
          saucingMethod,
          partyFiveSpecial,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
        ? saucingMethod
        : defaultSaucingMethodForCount(
            effectiveSaucedCount,
            partyFiveSpecial,
            requiredFlavourCount,
            threeFlavourTellUsHow,
          );

    const modifierSelections: CartModifierSelection[] = [];
    const wingTypeSelection = resolveWingTypeModifier(
      selectedOption,
      wingType,
      resolvedPreparation,
    );
    if (wingTypeSelection) {
      modifierSelections.push(wingTypeSelection);
    }
    for (const group of extraGroups) {
      const picks = extraGroupSelections[group.id] ?? [];
      for (const optionId of picks) {
        const opt = group.options.find((o) => o.id === optionId);
        if (!opt) continue;
        modifierSelections.push({
          modifier_option_id: opt.id,
          group_name: group.name,
          option_name: opt.name,
          price_delta_cents: opt.price_delta_cents,
        });
      }
    }
    const saladModifierSelectionsList: Array<{
      modifier_option_id: string;
      name: string;
      price_delta_cents: number;
    }> = [];
    if (resolvedSaladItem) {
      for (const group of resolvedSaladItem.modifier_groups) {
        if (group.context_key !== "addon") continue;
        const picks = saladModifierSelections[group.id] ?? [];
        for (const optionId of picks) {
          const option = group.options.find((candidate) => candidate.id === optionId);
          if (!option) continue;
          saladModifierSelectionsList.push({
            modifier_option_id: option.id,
            name: option.name,
            price_delta_cents: option.price_delta_cents,
          });
          modifierSelections.push({
            modifier_option_id: option.id,
            group_name: group.name,
            option_name: option.name,
            price_delta_cents: option.price_delta_cents,
          });
        }
      }
    }

    const placements = resolveSaucingPlacements({
      flavourIds: flavourSelections,
      flavourMap,
      saucingMethod: resolvedSaucingMethod,
      sideSlot: sideFlavourSlot,
    });
    const flavourSlots = flavourSelections.map((flavourId, index) => {
      const flavour = flavourMap.get(flavourId) as WingFlavour;
      return {
        slot_no: index + 1,
        wing_flavour_id: flavour.id,
        flavour_name: flavour.name,
        placement: placements[index] ?? "ON_WINGS",
      };
    });

    const extraFlavour = extraFlavourEnabled
      ? flavourMap.get(extraFlavourId)
      : undefined;

    const builderPayload: WingBuilderPayload = {
      builder_type: "WINGS",
      wing_type: wingType,
      preparation: resolvedPreparation,
      weight_lb: selectedOption.weight_lb,
      flavour_slots: flavourSlots,
      saucing_method: resolvedSaucingMethod ?? undefined,
      saucing_customer_note:
        tellUsHowSaucing && resolvedSaucingMethod === "TELL_US_HOW" && instructions.trim()
          ? instructions.trim()
          : undefined,
      side_flavour_slot_no:
        methodRequiresSideFlavourPick(
          effectiveSaucedCount,
          resolvedSaucingMethod,
        ) &&
        hasValidSideFlavourSlot &&
        sideFlavourSlot
          ? sideFlavourSlot
          : undefined,
      extra_flavour: extraFlavour
        ? {
            wing_flavour_id: extraFlavour.id,
            flavour_name: extraFlavour.name,
            placement: extraPlacement,
          }
        : undefined,
      salad_customization: resolvedSaladItem
        ? {
            salad_menu_item_id: resolvedSaladItem.id,
            salad_name: resolvedSaladItem.name,
            salad_slug: resolvedSaladItem.slug,
            removed_ingredients: resolvedSaladItem.removable_ingredients
              .filter((ingredient) => saladRemovedIngredientIds.has(ingredient.id))
              .map((ingredient) => ({ id: ingredient.id, name: ingredient.name })),
            modifier_selections: saladModifierSelectionsList,
          }
        : undefined,
    };

    const removedIngredients: RemovedIngredientSelection[] =
      usesChildSaladCustomization
        ? []
        : item.removable_ingredients
            .filter((ingredient) => removedIngredientIds.has(ingredient.id))
            .map((ingredient) => ({ id: ingredient.id, name: ingredient.name }));

    const incoming = {
      menu_item_id: selectedOption.menu_item_id,
      menu_item_slug: selectedOption.slug,
      name: selectedOption.name,
      image_url: item.image_url,
      base_price_cents: selectedOption.base_price_cents,
      quantity,
      modifier_selections: modifierSelections,
      removed_ingredients: removedIngredients,
      special_instructions: instructions.trim(),
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
      description={
        menuCardDescriptionForItem(item) ??
        "Build your wings exactly how you want them."
      }
      onClose={onClose}
      closeAriaLabel="Close wings builder"
      steps={steps}
      quantity={quantity}
      onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
      onIncrease={() => setQuantity((value) => value + 1)}
      quantityDisabled={!isReadyToSubmit}
      totalCents={liveUnitPrice * quantity}
      submitLabel={builderSubmitLabel(Boolean(editingLine))}
      onSubmit={handleAdd}
    >
          {showWeightStep ? (
            <StepContainer
              title="Pound size"
              invalid={submitAttempted && validationError === "quantity"}
              inlineError={
                submitAttempted && validationError === "quantity"
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef("quantity", node)}
            >
              <div className="builder-option-pills">
                {weightOptions.map((option) => (
                  <button
                    key={option.menu_item_id}
                    type="button"
                    className={`builder-option-pill${selectedWeightId === option.menu_item_id ? " builder-option-pill-active" : ""}`}
                    onClick={() => setSelectedWeightId(option.menu_item_id)}
                  >
                    {option.weight_lb} lb / {option.flavour_count} flavour
                    {option.flavour_count === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            </StepContainer>
          ) : null}

          <StepContainer
            title="Wing Preparation"
            subtitle="Choose how the wings should be prepared."
            invalid={submitAttempted && validationError === "preparation"}
            inlineError={
              submitAttempted && validationError === "preparation"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("preparation", node)}
          >
            <div className="builder-option-pills">
              {WING_PREPARATION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`builder-option-pill${
                    selectedWingPreparationId(wingType, preparation) === option.id
                      ? " builder-option-pill-active"
                      : ""
                  }`}
                  onClick={() => {
                    setWingType(option.wingType);
                    setPreparation(option.preparation);
                  }}
                >
                  {option.label}
                  {option.priceNote ? ` (${option.priceNote})` : ""}
                </button>
              ))}
            </div>
          </StepContainer>

          <StepContainer
            title="Flavours"
            subtitle={
              requiredFlavourCount > 0
                ? `Choose ${requiredFlavourCount} flavour${requiredFlavourCount === 1 ? "" : "s"}.`
                : "Select a quantity first to unlock flavours."
            }
            invalid={submitAttempted && validationError === "flavours"}
            inlineError={
              submitAttempted && validationError === "flavours"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("flavours", node)}
          >
            {loading ? (
              <p className="builder-inline-copy">Loading wing flavours...</p>
            ) : error ? (
              <p className="builder-inline-copy builder-inline-copy-error">{error}</p>
            ) : (
              <div className="builder-slot-stack">
                {flavourSelections.map((selection, index) => (
                  <div key={`slot-${index + 1}`} className="builder-slot-block">
                    <h4>Flavour {index + 1}</h4>
                    <FlavourPicker
                      flavours={flavours}
                      selectedFlavourId={selection}
                      onSelect={(flavour) =>
                        setFlavourSelections((prev) => {
                          const next = [...prev];
                          next[index] = flavour.id;
                          return next;
                        })
                      }
                      disabled={!selectedOption}
                    />
                  </div>
                ))}
              </div>
            )}
          </StepContainer>

          {showsSaucingStep ? (
            <StepContainer
              title="Saucing method"
              subtitle={
                effectiveSaucedCount <= 1
                  ? "Choose how that sauce should be served."
                  : "Choose how those flavours should be distributed."
              }
              invalid={submitAttempted && validationError === "saucing"}
              inlineError={
                submitAttempted && validationError === "saucing"
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef("saucing", node)}
            >
              <SaucingMethodPicker
                effectiveSaucedCount={effectiveSaucedCount}
                slotCount={requiredFlavourCount}
                value={saucingMethod}
                onChange={handleSaucingMethodChange}
                partyFiveSpecial={partyFiveSpecial}
                threeFlavourTellUsHow={threeFlavourTellUsHow}
                sideFlavourOptions={sideFlavourOptions}
                sideFlavourSlot={sideFlavourSlot}
                onSideFlavourSlotChange={setSideFlavourSlot}
              />
            </StepContainer>
          ) : null}

          <StepContainer
            title="Extra flavour"
            subtitle="Extra sauce for an added charge."
            invalid={submitAttempted && validationError === "extra-flavour"}
            inlineError={
              submitAttempted && validationError === "extra-flavour"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("extra-flavour", node)}
          >
            <label className="builder-inline-toggle">
              <input
                type="checkbox"
                checked={extraFlavourEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setExtraFlavourEnabled(enabled);
                  if (!enabled) {
                    setExtraFlavourId("");
                    setExtraPlacement("ON_WINGS");
                  } else {
                    setExtraFlavourId((id) => {
                      if (!id) return id;
                      const f = flavours.find((fl) => fl.id === id);
                      return f?.is_plain ? "" : id;
                    });
                  }
                }}
              />
              <span>
                Add extra flavour for <ExtraFlavourPrice />
              </span>
            </label>

            {extraFlavourEnabled && !loading && !error ? (
              <ExtraFlavourPicker
                flavours={flavours}
                selectedFlavourId={extraFlavourId}
                onSelect={(flavour) => setExtraFlavourId(flavour.id)}
              />
            ) : null}
          </StepContainer>

          {extraFlavourEnabled && !loading && !error ? (
            <StepContainer
              title="Saucing method"
              subtitle="How to apply your extra sauce."
              ref={(node) => setStepRef("extra-flavour-saucing", node)}
            >
              <div className="builder-option-pills builder-extra-flavour-saucing">
                <button
                  type="button"
                  className={`builder-option-pill${extraPlacement === "ON_WINGS" ? " builder-option-pill-active" : ""}`}
                  onClick={() => setExtraPlacement("ON_WINGS")}
                >
                  Tossed on wings
                </button>
                <button
                  type="button"
                  className={`builder-option-pill${extraPlacement === "ON_SIDE" ? " builder-option-pill-active" : ""}`}
                  onClick={() => setExtraPlacement("ON_SIDE")}
                >
                  On the side
                </button>
              </div>
            </StepContainer>
          ) : null}

          {usesChildSaladCustomization && selectedSaladGroup ? (
            <StepContainer
              key={selectedSaladGroup.id}
              title={selectedSaladGroup.display_label || selectedSaladGroup.name}
              subtitle={
                selectedSaladGroup.selection_mode === "MULTI"
                  ? selectedSaladGroup.max_select
                    ? `Pick up to ${selectedSaladGroup.max_select}.`
                    : "Pick any."
                  : selectedSaladGroup.is_required
                    ? "Pick one."
                    : "Pick one if you want."
              }
              invalid={
                submitAttempted &&
                validationError === `extra-${selectedSaladGroup.id}`
              }
              inlineError={
                submitAttempted &&
                validationError === `extra-${selectedSaladGroup.id}`
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef(`extra-${selectedSaladGroup.id}`, node)}
            >
              <div className="builder-option-pills">
                {selectedSaladGroup.options.map((opt) => {
                  const active = saladPickerPicks.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                      onClick={() => toggleExtraOption(selectedSaladGroup, opt.id)}
                    >
                      {normalizeIngredientDisplayText(opt.name)}
                      {opt.price_delta_cents > 0 ? (
                        <>
                          {" "}
                          (+
                          <span className="price-text">
                            ${(opt.price_delta_cents / 100).toFixed(2)}
                          </span>
                          )
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </StepContainer>
          ) : null}

          {usesChildSaladCustomization && activeRemovableIngredients.length > 0 ? (
            <StepContainer
              title="Salad ingredient removals"
              subtitle={
                resolvedSaladItem
                  ? `Tap items to leave off your ${resolvedSaladItem.name.toLowerCase()}.`
                  : "Tap items to leave off (e.g. salad toppings)."
              }
              invalid={submitAttempted && validationError === "ingredient-removals"}
              inlineError={
                submitAttempted && validationError === "ingredient-removals"
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef("ingredient-removals", node)}
            >
              <div className="builder-option-pills" style={{ flexWrap: "wrap" }}>
                {activeRemovableIngredients.map((ingredient) => {
                  const active = activeRemovedIngredientIds.has(ingredient.id);
                  return (
                    <button
                      key={ingredient.id}
                      type="button"
                      className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                      onClick={() =>
                        setSaladRemovedIngredientIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(ingredient.id)) next.delete(ingredient.id);
                          else next.add(ingredient.id);
                          return next;
                        })
                      }
                    >
                      No{" "}
                      <span
                        style={
                          active
                            ? { textDecoration: "line-through", textDecorationThickness: "0.06em" }
                            : undefined
                        }
                      >
                        {normalizeIngredientDisplayText(ingredient.name)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </StepContainer>
          ) : null}

          {usesChildSaladCustomization && saladAddonGroups.length > 0 ? (
            <StepContainer
              title="Additional ingredients"
              subtitle="Add Extra items."
              invalid={submitAttempted && validationError === "salad-addons"}
              inlineError={
                submitAttempted && validationError === "salad-addons"
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef("salad-addons", node)}
            >
              <div className="builder-slot-stack">
                {saladAddonGroups.map((group) => {
                  const picks = saladModifierSelections[group.id] ?? [];
                  const subtitle =
                    group.selection_mode === "MULTI"
                      ? group.max_select
                        ? `Pick up to ${group.max_select}.`
                        : "Pick any."
                      : group.is_required
                        ? "Pick one."
                        : "Pick one if you want.";
                  return (
                    <div key={group.id} className="builder-slot-block">
                      {saladAddonGroups.length > 1 ? (
                        <h4>{normalizeSaladAddonDisplayLabel(group.display_label, group.name)}</h4>
                      ) : null}
                      {saladAddonGroups.length > 1 ? (
                        <p className="builder-inline-copy" style={{ marginBottom: "0.75rem" }}>
                          {subtitle}
                        </p>
                      ) : null}
                      <div className="builder-option-pills">
                        {group.options.map((option) => {
                          const active = picks.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                              onClick={() => toggleSaladAddonOption(group, option.id)}
                            >
                              {normalizeIngredientDisplayText(option.name)}
                              {option.price_delta_cents > 0 ? (
                                <>
                                  {" "}
                                  (+
                                  <span className="price-text">
                                    ${(option.price_delta_cents / 100).toFixed(2)}
                                  </span>
                                  )
                                </>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </StepContainer>
          ) : null}

          {extraGroupsMinusSalad.map((group) => {
            const stepKey = `extra-${group.id}`;
            const picks = extraGroupSelections[group.id] ?? [];
            const subtitle =
              group.selection_mode === "MULTI"
                ? group.max_select
                  ? `Pick up to ${group.max_select}.`
                  : "Pick any."
                : group.is_required
                  ? "Pick one."
                  : "Pick one if you want.";
            return (
              <StepContainer
                key={group.id}
                title={group.display_label || group.name}
                subtitle={subtitle}
                invalid={submitAttempted && validationError === stepKey}
                inlineError={
                  submitAttempted && validationError === stepKey
                    ? BUILDER_VALIDATION_MESSAGE
                    : null
                }
                ref={(node) => setStepRef(stepKey, node)}
              >
                <div className="builder-option-pills">
                  {group.options.map((opt) => {
                    const active = picks.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                        onClick={() => toggleExtraOption(group, opt.id)}
                      >
                        {normalizeIngredientDisplayText(opt.name)}
                        {opt.price_delta_cents > 0 ? (
                          <>
                            {" "}
                            (+
                            <span className="price-text">
                              ${(opt.price_delta_cents / 100).toFixed(2)}
                            </span>
                            )
                          </>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </StepContainer>
            );
          })}

          {!usesChildSaladCustomization && activeRemovableIngredients.length > 0 ? (
            <StepContainer
              title="Ingredient removals"
              subtitle="Tap items to leave off (e.g. salad toppings)."
              invalid={submitAttempted && validationError === "ingredient-removals"}
              inlineError={
                submitAttempted && validationError === "ingredient-removals"
                  ? BUILDER_VALIDATION_MESSAGE
                  : null
              }
              ref={(node) => setStepRef("ingredient-removals", node)}
            >
              <div className="builder-option-pills" style={{ flexWrap: "wrap" }}>
                {activeRemovableIngredients.map((ingredient) => {
                  const active = activeRemovedIngredientIds.has(ingredient.id);
                  return (
                    <button
                      key={ingredient.id}
                      type="button"
                      className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                      onClick={() =>
                        setRemovedIngredientIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(ingredient.id)) next.delete(ingredient.id);
                          else next.add(ingredient.id);
                          return next;
                        })
                      }
                    >
                      No{" "}
                      <span
                        style={
                          active
                            ? { textDecoration: "line-through", textDecorationThickness: "0.06em" }
                            : undefined
                        }
                      >
                        {normalizeIngredientDisplayText(ingredient.name)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </StepContainer>
          ) : null}

          <StepContainer
            title="Special instructions"
            subtitle={
              tellUsHowSaucing && saucingMethod === "TELL_US_HOW"
                ? "Describe how you want the sauces applied."
                : "Notes for the kitchen."
            }
            invalid={submitAttempted && validationError === "instructions"}
            inlineError={
              submitAttempted && validationError === "instructions"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("instructions", node)}
          >
            <textarea
              className="builder-textarea"
              rows={4}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={
                tellUsHowSaucing && saucingMethod === "TELL_US_HOW"
                  ? "e.g. one flavour per section, two on the side…"
                  : "Anything we should know?"
              }
            />
          </StepContainer>
    </BuilderShell>
  );
}
