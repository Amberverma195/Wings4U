import { modifierTotal, validateSelections } from '@wings4u/customization';
import { savedSelectionReview } from "../lib/cart-validation";
/**
 * mobile-wings-builder.tsx
 *
 * Mobile Wings (By the Pound) builder with 1:1 functional parity with the
 * website's WingsBuilder component (apps/web/src/components/wings-builder.tsx).
 *
 * Implements:
 *  - Pound-size selection (multi-option or auto-selected single-option)
 *  - Wing Preparation (Breaded Bone-In / Non-Breaded Bone-In / Breaded Boneless)
 *  - Flavour selection with heat-level tabs (locked until size chosen)
 *  - Saucing method (all website eligibility rules)
 *  - Extra flavour (paid, +$1.00, no plain)
 *  - Extra groups (pop slot, salad, dip, etc.)
 *  - Removable ingredients
 *  - Special instructions / saucing note
 *  - Cart editing (pre-fill + replace)
 *  - Exact WingBuilderPayload semantics
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCart } from '../context/cart';
import type {
  BuilderMenuOption,
  CartItem,
  CartModifierSelection,
  MenuItem,
  ModifierGroup,
  RemovedIngredientSelection,
  WingBuilderPayload,
  WingFlavour,
} from '../lib/types';
import {
  BONELESS_WINGS_UPCHARGE_CENTS,
  EXTRA_FLAVOUR_PRICE_CENTS,
  WING_PREPARATION_OPTIONS,
  areAllSelectedFlavoursPlain,
  countEffectiveSaucedFlavours,
  defaultSaucingMethodForCount,
  extractWeightLb,
  formatCents,
  isFlavourWithoutSauce,
  isItemAvailableForOrder,
  isSaucingMethodValidForCount,
  methodRequiresSideFlavourPick,
  normalizeInitialPreparation,
  resolveSaucingPlacements,
  selectedWingPreparationId,
  type Preparation,
  type WingType,
} from '../lib/wing-builder-logic';
import {
  embeddedSaladCatalog,
  WINGS_SPECIAL_SALAD_SIZE_LABEL,
  findSaladMenuItemForSelection,
  normalizeSaladAddonDisplayLabel,
  saladItemSupportsSize,
} from '../lib/salad-catalog';
import {
  BUILDER_VALIDATION_MESSAGE,
  ExtraFlavourPicker,
  FlavourPicker,
  MobileBuilderShell,
  NotesInput,
  OptionPills,
  P,
  SaucingMethodPicker,
  StepCard,
  useWingFlavours,
} from './mobile-builder-shell';

/* ------------------------------------------------------------------ */
/*  Helpers (mirrors wings-builder.tsx helpers)                        */
/* ------------------------------------------------------------------ */

function countFlavourGroups(groups: ModifierGroup[]) {
  return groups.filter((g) => g.options.some((o) => o.linked_flavour_id)).length;
}

function builderWeightLbForItem(item: MenuItem): number {
  if (item.slug === 'wings-4u-special') return 2;
  return extractWeightLb(item.name);
}

function buildFallbackWeightOption(item: MenuItem): BuilderMenuOption {
  return {
    menu_item_id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    base_price_cents: item.base_price_cents,
    weight_lb: builderWeightLbForItem(item),
    flavour_count: countFlavourGroups(item.modifier_groups),
    side_slot_count: 0,
    drink_slot_count: 0,
    modifier_groups: item.modifier_groups,
  };
}

function findWingTypeGroup(option: BuilderMenuOption): ModifierGroup | undefined {
  return option.modifier_groups.find(
    (g) => /wing type/i.test(g.name) || /wing type/i.test(g.display_label),
  );
}

function resolveWingTypeModifier(
  option: BuilderMenuOption,
  wingType: Exclude<WingType, null>,
  preparation: Exclude<Preparation, null>,
): CartModifierSelection | null {
  const group = findWingTypeGroup(option);
  if (!group) return null;

  const selected =
    group.options.find((optionItem) => {
      const normalized = optionItem.name.toLowerCase();
      if (wingType === 'BONELESS') return normalized.includes('boneless');
      if (preparation === 'BREADED')
        return (
          normalized.includes('breaded') &&
          normalized.includes('bone') &&
          !normalized.includes('non')
        );
      return (
        normalized.includes('non') &&
        normalized.includes('breaded') &&
        normalized.includes('bone')
      );
    }) ??
    group.options.find((optionItem) => {
      const n = optionItem.name.toLowerCase();
      const target =
        wingType === 'BONELESS'
          ? ['boneless']
          : preparation === 'BREADED'
            ? ['breaded', 'bone']
            : ['non', 'breaded', 'bone'];
      return target.every((token) => n.includes(token));
    });

  if (!selected) return null;
  return {
    modifier_option_id: selected.id,
    group_name: group.name,
    option_name: selected.name,
    price_delta_cents: selected.price_delta_cents,
  };
}

function getExtraModifierGroups(
  option: BuilderMenuOption,
  partyFiveSpecial: boolean,
  wingsByThePoundFlow: boolean,
  usesChildSaladCustomization: boolean,
): ModifierGroup[] {
  const wingTypeGroup = findWingTypeGroup(option);
  const groups = option.modifier_groups
    .filter((group) => {
      if (wingTypeGroup && group.id === wingTypeGroup.id) return false;
      if (group.options.some((opt) => opt.linked_flavour_id)) return false;
      if (group.context_key === 'size') return false;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  if (partyFiveSpecial || wingsByThePoundFlow || usesChildSaladCustomization) {
    return groups.filter((g) => g.context_key !== 'addon');
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  item: MenuItem;
  visible: boolean;
  onClose: () => void;
  editingLine?: CartItem | null;
  saladMenuItems?: MenuItem[];
};

/* ================================================================== */
/*  WingsBuilderMobile                                                 */
/* ================================================================== */

export function WingsBuilderMobile({
  item,
  visible,
  onClose,
  editingLine,
  saladMenuItems = [],
}: Props) {
  const { addItem, replaceItem, fulfillmentType } = useCart();
  const { flavours, loading, error, retry } = useWingFlavours(item);

  const editingPayload =
    editingLine?.builder_payload?.builder_type === 'WINGS'
      ? (editingLine.builder_payload as WingBuilderPayload)
      : undefined;

  const partyFiveSpecial =
    item.slug === 'party-75-wings' || item.slug === 'party-100-wings';
  const wingsByThePoundFlow =
    item.slug === 'wings-by-the-pound' ||
    /^wings-(?:\d+(?:\.\d+)?)lb$/.test(item.slug);
  const usesChildSaladCustomization = item.slug === 'wings-4u-special';

  const weightOptions = useMemo(
    () =>
      item.weight_options?.length
        ? item.weight_options
        : [buildFallbackWeightOption(item)],
    [item],
  );
  const showWeightStep = weightOptions.length > 1;

  /* State */
  const [selectedWeightId, setSelectedWeightId] = useState<string | null>(
    editingLine?.menu_item_id ?? null,
  );
  const initialWingType = editingPayload?.wing_type ?? null;
  const [wingType, setWingType] = useState<WingType>(initialWingType);
  const [preparation, setPreparation] = useState<Preparation>(
    normalizeInitialPreparation(initialWingType, editingPayload?.preparation ?? null),
  );
  const [flavourSelections, setFlavourSelections] = useState<string[]>(
    () => editingPayload?.flavour_slots?.map((s) => s.wing_flavour_id) ?? [],
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
    editingPayload?.extra_flavour?.wing_flavour_id ?? '',
  );
  const [extraPlacement, setExtraPlacement] = useState<'ON_WINGS' | 'ON_SIDE'>(
    editingPayload?.extra_flavour?.placement === 'ON_SIDE' ? 'ON_SIDE' : 'ON_WINGS',
  );
  const [instructions, setInstructions] = useState(() => {
    const raw = editingLine?.special_instructions ?? '';
    const note = editingPayload?.saucing_customer_note?.trim();
    if (!note || !raw) return raw;
    const head = `Saucing: ${note}`;
    if (raw === head) return '';
    if (raw.startsWith(`${head}\n\n`)) return raw.slice(head.length + 2);
    if (raw.startsWith(`${head}\n`)) return raw.slice(head.length + 1).trim();
    if (raw.startsWith(head)) return raw.slice(head.length).trim();
    return raw;
  });
  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<string>>(
    new Set(editingLine?.removed_ingredients?.map((r) => r.id) ?? []),
  );
  const editingSaladCustomization = editingPayload?.salad_customization;
  const [saladRemovedIngredientIds, setSaladRemovedIngredientIds] = useState<Set<string>>(
    () =>
      new Set(
        editingSaladCustomization?.removed_ingredients.map((ingredient) => ingredient.id) ?? [],
      ),
  );
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [extraGroupSelections, setExtraGroupSelections] = useState<Record<string, string[]>>({});
  const [saladModifierSelections, setSaladModifierSelections] = useState<Record<string, string[]>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const previousSaladItemIdRef = useRef<string | null>(null);

  /* Reset on open */
  const prevVisible = useRef(false);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      // Reset state for a new open (only if not editing)
      if (!editingLine) {
        setSelectedWeightId(null);
        setWingType(null);
        setPreparation(null);
        setFlavourSelections([]);
        setSaucingMethod(null);
        setSideFlavourSlot(null);
        setExtraFlavourEnabled(false);
        setExtraFlavourId('');
        setExtraPlacement('ON_WINGS');
        setInstructions('');
        setRemovedIngredientIds(new Set());
        setSaladRemovedIngredientIds(new Set());
        setQuantity(1);
        setExtraGroupSelections({});
        setSaladModifierSelections({});
        setSubmitAttempted(false);
        previousSaladItemIdRef.current = null;
      }
    }
    prevVisible.current = visible;
  }, [visible, editingLine]);

  /* Derived */
  const selectedOption = useMemo(
    () => weightOptions.find((o) => o.menu_item_id === selectedWeightId) ?? null,
    [selectedWeightId, weightOptions],
  );
  const requiredFlavourCount = selectedOption?.flavour_count ?? 0;
  const threeFlavourTellUsHow = requiredFlavourCount === 3;
  const tellUsHowSaucing = partyFiveSpecial || threeFlavourTellUsHow;

  const extraGroups = useMemo(() => {
    if (!selectedOption) return [];
    return getExtraModifierGroups(selectedOption, partyFiveSpecial, wingsByThePoundFlow, usesChildSaladCustomization);
  }, [selectedOption, partyFiveSpecial, wingsByThePoundFlow, usesChildSaladCustomization]);

  /** Wings-4-U Special: drink/pop slots render after salad selection and extras */
  const extraGroupsMinusSalad = useMemo(
    () =>
      usesChildSaladCustomization
        ? extraGroups.filter((group) => group.context_key !== 'salad')
        : extraGroups,
    [extraGroups, usesChildSaladCustomization],
  );

  const selectedSaladGroup = useMemo(() => {
    const group = extraGroups.find((candidate) => candidate.context_key === 'salad') ?? null;
    if (!group || !usesChildSaladCustomization) return group;

    return {
      ...group,
      options: group.options.filter((option) => {
        const saladItem = findSaladMenuItemForSelection(saladMenuItems, option.name);
        return saladItem ? saladItemSupportsSize(saladItem, WINGS_SPECIAL_SALAD_SIZE_LABEL) : false;
      }),
    };
  }, [extraGroups, saladMenuItems, usesChildSaladCustomization]);

  const saladPickerPicks = useMemo(
    () => (selectedSaladGroup ? extraGroupSelections[selectedSaladGroup.id] ?? [] : []),
    [extraGroupSelections, selectedSaladGroup],
  );

  const selectedSaladOption = useMemo(() => {
    if (!selectedSaladGroup) return null;
    const selectedId = extraGroupSelections[selectedSaladGroup.id]?.[0];
    return selectedSaladGroup.options.find((option) => option.id === selectedId) ?? null;
  }, [extraGroupSelections, selectedSaladGroup]);

  const resolvedSaladItem = useMemo(() => {
    if (!usesChildSaladCustomization || !selectedSaladOption) return null;
    const saladItem = findSaladMenuItemForSelection(saladMenuItems, selectedSaladOption.name);
    if (!saladItem || !saladItemSupportsSize(saladItem, WINGS_SPECIAL_SALAD_SIZE_LABEL)) {
      return null;
    }
    return saladItem;
  }, [saladMenuItems, selectedSaladOption, usesChildSaladCustomization]);

  const activeRemovableIngredients = useMemo(
    () =>
      usesChildSaladCustomization
        ? resolvedSaladItem?.removable_ingredients ?? []
        : item.removable_ingredients,
    [item.removable_ingredients, resolvedSaladItem, usesChildSaladCustomization],
  );

  const saladAddonGroups = useMemo(() => resolvedSaladItem
    ? embeddedSaladCatalog(resolvedSaladItem).groups : [], [resolvedSaladItem]);
  const saladSelectionError = validateSelections(saladAddonGroups, saladModifierSelections);

  /* Auto-select single weight option */
  useEffect(() => {
    if (!selectedWeightId && weightOptions.length === 1) {
      setSelectedWeightId(weightOptions[0]!.menu_item_id);
    }
  }, [selectedWeightId, weightOptions]);

  /* Resize and prune flavour slots when required count changes or catalogue updates */
  useEffect(() => {
    setFlavourSelections((prev) =>
      Array.from({ length: requiredFlavourCount }, (_, i) => {
        const id = prev[i] ?? '';
        if (id && flavours.length > 0 && !flavours.some((f) => f.id === id)) {
          return '';
        }
        return id;
      }),
    );
  }, [requiredFlavourCount, flavours]);

  const flavourMap = useMemo(
    () => new Map(flavours.map((f) => [f.id, f])),
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
      sideFlavourOptions.some((o) => o.slotNo === sideFlavourSlot),
    [sideFlavourOptions, sideFlavourSlot],
  );
  const showsSaucingStep = requiredFlavourCount >= 1 && !allMainFlavoursPlain;

  /* Auto-adjust saucing method when effective sauce count changes */
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
  }, [effectiveSaucedCount, partyFiveSpecial, requiredFlavourCount, threeFlavourTellUsHow]);

  /* Clear side flavour slot if method no longer needs it */
  useEffect(() => {
    if (!methodRequiresSideFlavourPick(effectiveSaucedCount, saucingMethod)) {
      setSideFlavourSlot(null);
    } else {
      setSideFlavourSlot((prev) =>
        prev && sideFlavourOptions.some((o) => o.slotNo === prev) ? prev : null,
      );
    }
  }, [effectiveSaucedCount, saucingMethod, sideFlavourOptions]);

  /* Clear plain or invalid extra flavour if selected */
  useEffect(() => {
    if (!extraFlavourEnabled || !extraFlavourId) return;
    const picked = flavours.find((f) => f.id === extraFlavourId);
    if (!picked || picked.is_plain || picked.heat_level === 'PLAIN') {
      setExtraFlavourId('');
    }
  }, [extraFlavourEnabled, extraFlavourId, flavours]);

  /* Salad edit hydration & change detection */
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
        if (group.context_key !== 'addon') continue;
        const picks = editingSaladCustomization.modifier_selections
          .filter((selection) => {
            const matchesCartSelection = editingLine.modifier_selections?.some(
              (sel) =>
                sel.modifier_option_id === selection.modifier_option_id &&
                (sel.group_name === group.name || sel.group_name === group.display_label),
            );
            const matchesGroupOption = group.options.some(
              (option) => option.id === selection.modifier_option_id,
            );
            return matchesCartSelection || matchesGroupOption;
          })
          .map((selection) => selection.modifier_option_id);
        if (picks.length > 0) {
          nextSelections[group.id] = picks;
        }
      }
      setSaladRemovedIngredientIds(
        new Set(editingSaladCustomization.removed_ingredients.map((ing) => ing.id)),
      );
      const unknown = editingSaladCustomization.modifier_selections.map(row => row.modifier_option_id)
        .filter(id => !Object.values(nextSelections).flat().includes(id));
      if (unknown.length) nextSelections.__stale__ = unknown;
      setSaladModifierSelections(nextSelections);
      previousSaladItemIdRef.current = nextSaladItemId;
      return;
    }

    if (previousSaladItemIdRef.current !== nextSaladItemId) {
      setSaladRemovedIngredientIds(new Set());
      setSaladModifierSelections({});
      previousSaladItemIdRef.current = nextSaladItemId;
    }
  }, [editingLine, editingSaladCustomization, resolvedSaladItem, usesChildSaladCustomization]);

  /* Revalidate and prune extraGroupSelections when extraGroups change (e.g. variant change) */
  useEffect(() => {
    setExtraGroupSelections((prev) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      const activeGroupIds = new Set(extraGroups.map((g) => g.id));

      for (const group of extraGroups) {
        const current = prev[group.id];
        if (!current?.length) continue;

        const validOptionIds = new Set(group.options.map((option) => option.id));
        let validPicks = current.filter((optionId) => validOptionIds.has(optionId));
        validPicks = Array.from(new Set(validPicks));
        if (group.selection_mode === 'SINGLE' && validPicks.length > 1) {
          validPicks = validPicks.slice(0, 1);
        }
        if (group.max_select && validPicks.length > group.max_select) {
          validPicks = validPicks.slice(0, group.max_select);
        }

        if (validPicks.length > 0) {
          next[group.id] = validPicks;
        }
        if (validPicks.length !== current.length) {
          changed = true;
        }
      }

      for (const prevKey of Object.keys(prev)) {
        if (!activeGroupIds.has(prevKey)) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [extraGroups]);

  /* Hydrate extra group selections when editing */
  useEffect(() => {
    if (!editingLine || extraGroups.length === 0) return;
    const next: Record<string, string[]> = {};
    for (const group of extraGroups) {
      const picks = editingLine.modifier_selections
        .filter((sel) => group.options.some((opt) => opt.id === sel.modifier_option_id))
        .map((sel) => sel.modifier_option_id)
        .filter((id): id is string => Boolean(id));
      if (picks.length > 0) next[group.id] = picks;
    }

    if (usesChildSaladCustomization && selectedSaladGroup) {
      const currentSaladPicks = next[selectedSaladGroup.id] ?? [];
      if (currentSaladPicks.length === 0 && editingSaladCustomization) {
        const matchingSalad = selectedSaladGroup.options.find((opt) => {
          const item = findSaladMenuItemForSelection(saladMenuItems, opt.name);
          return (
            item &&
            item.id === editingSaladCustomization.salad_menu_item_id &&
            saladItemSupportsSize(item, WINGS_SPECIAL_SALAD_SIZE_LABEL)
          );
        });
        if (matchingSalad) {
          next[selectedSaladGroup.id] = [matchingSalad.id];
        }
      }
    }

    setExtraGroupSelections((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOption, selectedSaladGroup]);

  /* Price */
  const extraGroupsTotalDelta = useMemo(() => {
    let total = 0;
    for (const group of extraGroups) {
      for (const id of (extraGroupSelections[group.id] ?? [])) {
        const opt = group.options.find((o) => o.id === id);
        if (opt) total += opt.price_delta_cents;
      }
    }
    return total;
  }, [extraGroups, extraGroupSelections]);

  const saladAddonsTotalDelta = modifierTotal(saladAddonGroups, saladModifierSelections);

  const liveUnitPrice =
    (selectedOption?.base_price_cents ?? 0) +
    (extraFlavourEnabled ? EXTRA_FLAVOUR_PRICE_CENTS : 0) +
    (wingType === 'BONELESS' ? BONELESS_WINGS_UPCHARGE_CENTS : 0) +
    extraGroupsTotalDelta +
    saladAddonsTotalDelta;

  const availability = useMemo(
    () => isItemAvailableForOrder(item, fulfillmentType),
    [item, fulfillmentType],
  );

  /* Validation */
  const validate = useCallback((): string | null => {
    if (!availability.available) return 'availability';
    if (!selectedOption) return 'quantity';
    if (!wingType || !preparation) return 'preparation';
    if (
      loading ||
      Boolean(error) ||
      (requiredFlavourCount > 0 && flavours.length === 0) ||
      flavourSelections.some((s) => !s || !flavours.some((f) => f.id === s))
    ) {
      return 'flavours';
    }
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
        return requiredFlavourCount >= 1 ? 'saucing' : null;
      }
      if (methodRequiresSideFlavourPick(effectiveSaucedCount, saucingMethod) && !hasValidSideFlavourSlot) {
        return 'saucing';
      }
    }
    if (tellUsHowSaucing && saucingMethod === 'TELL_US_HOW' && !instructions.trim()) {
      return 'instructions';
    }
    if (
      extraFlavourEnabled &&
      (!extraFlavourId || !flavours.some((f) => f.id === extraFlavourId && !f.is_plain && f.heat_level !== 'PLAIN'))
    ) {
      return 'extra-flavour';
    }

    if (usesChildSaladCustomization) {
      if (!selectedSaladGroup || selectedSaladGroup.options.length === 0) {
        return 'salad';
      }
      const saladPicks = extraGroupSelections[selectedSaladGroup.id] ?? [];
      if (saladPicks.length === 0) return 'salad';
      const pickedOptionId = saladPicks[0];
      const selectedOption = selectedSaladGroup.options.find((opt) => opt.id === pickedOptionId);
      if (!selectedOption) return 'salad';
      if (!resolvedSaladItem) return 'salad';
      if (!saladItemSupportsSize(resolvedSaladItem, WINGS_SPECIAL_SALAD_SIZE_LABEL)) {
        return 'salad';
      }

      if (saladSelectionError) return 'salad';
      for (const group of saladAddonGroups) {
        const picks = saladModifierSelections[group.id] ?? [];
        if (picks.some((optId) => !group.options.some((o) => o.id === optId))) {
          return `salad-addon-${group.id}`;
        }
        const min = group.is_required ? Math.max(group.min_select, 1) : group.min_select;
        if (picks.length < min) return `salad-addon-${group.id}`;
        if (group.max_select && picks.length > group.max_select) {
          return `salad-addon-${group.id}`;
        }
      }
    }

    for (const group of extraGroupsMinusSalad) {
      const picks = extraGroupSelections[group.id] ?? [];
      if (picks.some((optId) => !group.options.some((o) => o.id === optId))) {
        return `extra-${group.id}`;
      }
      if (new Set(picks).size !== picks.length) {
        return `extra-${group.id}`;
      }
      if (group.selection_mode === 'SINGLE' && picks.length > 1) {
        return `extra-${group.id}`;
      }
      const min = group.is_required ? Math.max(group.min_select, 1) : group.min_select;
      if (picks.length < min) return `extra-${group.id}`;
      if (group.max_select && picks.length > group.max_select) {
        return `extra-${group.id}`;
      }
    }
    return null;
  }, [
    allMainFlavoursPlain,
    availability.available,
    effectiveSaucedCount,
    error,
    extraFlavourEnabled,
    extraFlavourId,
    extraGroupSelections,
    extraGroupsMinusSalad,
    flavourSelections,
    flavours,
    hasValidSideFlavourSlot,
    instructions,
    loading,
    partyFiveSpecial,
    preparation,
    requiredFlavourCount,
    resolvedSaladItem,
    saladSelectionError,
    saladAddonGroups,
    saladModifierSelections,
    saucingMethod,
    selectedOption,
    selectedSaladGroup,
    selectedSaladOption,
    tellUsHowSaucing,
    threeFlavourTellUsHow,
    usesChildSaladCustomization,
    wingType,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  /* Auto-dismiss validation once ready */
  useEffect(() => {
    if (submitAttempted && isReadyToSubmit) setSubmitAttempted(false);
  }, [submitAttempted, isReadyToSubmit]);

  /* Submit */
  const handleAdd = useCallback(() => {
    const invalidStep = validate();
    if (invalidStep) {
      setSubmitAttempted(true);
      return;
    }
    if (!selectedOption || !wingType || !preparation) return;
    if (usesChildSaladCustomization && !resolvedSaladItem) return;

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
    const wingTypeSelection = resolveWingTypeModifier(selectedOption, wingType, preparation);
    if (wingTypeSelection) modifierSelections.push(wingTypeSelection);
    for (const group of extraGroups) {
      for (const optionId of (extraGroupSelections[group.id] ?? [])) {
        const opt = group.options.find((o) => o.id === optionId);
        if (!opt) return;
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
      for (const group of saladAddonGroups) {
        const picks = saladModifierSelections[group.id] ?? [];
        for (const optionId of picks) {
          const option = group.options.find((candidate) => candidate.id === optionId);
          if (!option) return;
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
        placement: placements[index] ?? 'ON_WINGS',
      };
    });

    const extraFlavour = extraFlavourEnabled ? flavourMap.get(extraFlavourId) : undefined;

    const builderPayload: WingBuilderPayload = {
      builder_type: 'WINGS',
      wing_type: wingType,
      preparation,
      weight_lb: selectedOption.weight_lb,
      flavour_slots: flavourSlots,
      saucing_method: resolvedSaucingMethod ?? undefined,
      saucing_customer_note:
        tellUsHowSaucing && resolvedSaucingMethod === 'TELL_US_HOW' && instructions.trim()
          ? instructions.trim()
          : undefined,
      side_flavour_slot_no:
        methodRequiresSideFlavourPick(effectiveSaucedCount, resolvedSaucingMethod) &&
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

    const removedIngredients: RemovedIngredientSelection[] = usesChildSaladCustomization
      ? []
      : item.removable_ingredients
          .filter((ing) => removedIngredientIds.has(ing.id))
          .map((ing) => ({ id: ing.id, name: ing.name }));

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

    if (editingLine) replaceItem(editingLine.key, incoming);
    else addItem(incoming);
    onClose();
  }, [
    validate,
    selectedOption,
    wingType,
    preparation,
    allMainFlavoursPlain,
    effectiveSaucedCount,
    saucingMethod,
    partyFiveSpecial,
    requiredFlavourCount,
    threeFlavourTellUsHow,
    extraGroups,
    extraGroupSelections,
    flavourSelections,
    flavourMap,
    sideFlavourSlot,
    hasValidSideFlavourSlot,
    extraFlavourEnabled,
    extraFlavourId,
    extraPlacement,
    instructions,
    tellUsHowSaucing,
    item.removable_ingredients,
    item.image_url,
    removedIngredientIds,
    saladRemovedIngredientIds,
    saladModifierSelections,
    resolvedSaladItem,
    usesChildSaladCustomization,
    quantity,
    editingLine,
    addItem,
    replaceItem,
    onClose,
  ]);

  const toggleExtraOption = useCallback((group: ModifierGroup, optionId: string) => {
    setExtraGroupSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === 'SINGLE') {
        if (current.includes(optionId) && !group.is_required) {
          return { ...prev, [group.id]: [] };
        }
        return { ...prev, [group.id]: [optionId] };
      }
      if (current.includes(optionId)) return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      if (group.max_select && current.length >= group.max_select) return { ...prev, [group.id]: [...current.slice(1), optionId] };
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }, []);

  const toggleSaladAddonOption = useCallback((group: ModifierGroup, optionId: string) => {
    setSaladModifierSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === 'SINGLE') {
        if (current.includes(optionId) && !group.is_required) {
          return { ...prev, [group.id]: [] };
        }
        return { ...prev, [group.id]: [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (group.max_select && current.length >= group.max_select) {
        return { ...prev, [group.id]: [...current.slice(1), optionId] };
      }
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }, []);

  /* ================================================================ */
  /*  Render                                                           */
  const isHardDisabled =
    !availability.available ||
    loading ||
    Boolean(error) ||
    (requiredFlavourCount > 0 && flavours.length === 0);

  const submitLabel = editingLine ? 'Save changes' : 'Add to cart';

  const selectionReview = savedSelectionReview(editingLine, selectedOption, saladAddonGroups.flatMap(group => group.options.map(option => option.id)));

  return (
    <MobileBuilderShell
      visible={visible}
      title={item.name}
      description={item.description ?? 'Build your wings exactly how you want them.'}
      onClose={onClose}
      quantity={quantity}
      onDecrease={() => setQuantity((v) => Math.max(1, v - 1))}
      onIncrease={() => setQuantity((v) => v + 1)}
      quantityDisabled={isHardDisabled}
      totalCents={liveUnitPrice * quantity}
      submitLabel={submitLabel}
      submitDisabled={isHardDisabled}
      onSubmit={handleAdd}
    >

      {usesChildSaladCustomization && saladSelectionError ? <View>
        <Text accessibilityRole="alert">{saladSelectionError}</Text>
        <TouchableOpacity onPress={() => setSaladModifierSelections({})}><Text>Review salad extras: clear selections</Text></TouchableOpacity>
      </View> : null}
      {selectionReview ? <Text accessibilityRole="alert">{selectionReview}</Text> : null}
      {!availability.available ? (
        <View style={styles.unavailableBanner} accessibilityRole="alert">
          <Text style={styles.unavailableBannerText}>{availability.reason}</Text>
        </View>
      ) : null}
      {/* ---- Pound size ---- */}
      {showWeightStep ? (
        <StepCard
          title="Pound size"
          invalid={submitAttempted && validationError === 'quantity'}
          inlineError={submitAttempted && validationError === 'quantity' ? BUILDER_VALIDATION_MESSAGE : null}
        >
          <OptionPills
            options={weightOptions.map((o) => ({
              value: o.menu_item_id,
              label: `${o.weight_lb} lb / ${o.flavour_count} flavour${o.flavour_count === 1 ? '' : 's'}`,
            }))}
            value={selectedWeightId}
            onChange={setSelectedWeightId}
          />
        </StepCard>
      ) : null}

      {/* ---- Wing Preparation ---- */}
      <StepCard
        title="Wing Preparation"
        subtitle="Choose how the wings should be prepared."
        invalid={submitAttempted && validationError === 'preparation'}
        inlineError={submitAttempted && validationError === 'preparation' ? BUILDER_VALIDATION_MESSAGE : null}
      >
        <OptionPills
          options={WING_PREPARATION_OPTIONS.map((o) => ({
            value: o.id,
            label: o.priceNote ? `${o.label} (${o.priceNote})` : o.label,
          }))}
          value={selectedWingPreparationId(wingType, preparation)}
          onChange={(id) => {
            const opt = WING_PREPARATION_OPTIONS.find((o) => o.id === id);
            if (opt) {
              setWingType(opt.wingType);
              setPreparation(opt.preparation);
            }
          }}
        />
      </StepCard>

      {/* ---- Flavours ---- */}
      <StepCard
        title="Flavours"
        subtitle={
          requiredFlavourCount > 0
            ? `Choose ${requiredFlavourCount} flavour${requiredFlavourCount === 1 ? '' : 's'}.`
            : 'Select a quantity first to unlock flavours.'
        }
        invalid={submitAttempted && validationError === 'flavours'}
        inlineError={submitAttempted && validationError === 'flavours' ? BUILDER_VALIDATION_MESSAGE : null}
      >
        {loading ? (
          <Text style={styles.inlineCopy}>Loading wing flavours…</Text>
        ) : error ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={[styles.inlineCopy, styles.errorCopy]}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={retry} accessibilityRole="button">
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 20 }}>
            {flavourSelections.map((selection, index) => (
              <View key={`slot-${index + 1}`} style={{ gap: 8 }}>
                <Text style={styles.slotLabel}>Flavour {index + 1}</Text>
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
              </View>
            ))}
          </View>
        )}
      </StepCard>

      {/* ---- Saucing method ---- */}
      {showsSaucingStep ? (
        <StepCard
          title="Saucing method"
          subtitle={
            effectiveSaucedCount <= 1
              ? 'Choose how that sauce should be served.'
              : 'Choose how those flavours should be distributed.'
          }
          invalid={submitAttempted && validationError === 'saucing'}
          inlineError={submitAttempted && validationError === 'saucing' ? BUILDER_VALIDATION_MESSAGE : null}
        >
          <SaucingMethodPicker
            effectiveSaucedCount={effectiveSaucedCount}
            slotCount={requiredFlavourCount}
            value={saucingMethod}
            onChange={setSaucingMethod}
            partyFiveSpecial={partyFiveSpecial}
            threeFlavourTellUsHow={threeFlavourTellUsHow}
            sideFlavourOptions={sideFlavourOptions}
            sideFlavourSlot={sideFlavourSlot}
            onSideFlavourSlotChange={setSideFlavourSlot}
          />
        </StepCard>
      ) : null}

      {/* ---- Extra flavour ---- */}
      <StepCard
        title="Extra flavour"
        subtitle="Extra sauce for an added charge."
        invalid={submitAttempted && validationError === 'extra-flavour'}
        inlineError={submitAttempted && validationError === 'extra-flavour' ? BUILDER_VALIDATION_MESSAGE : null}
      >
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            Add extra flavour for{' '}
            <Text style={{ color: P.red }}>{formatCents(EXTRA_FLAVOUR_PRICE_CENTS)}</Text>
          </Text>
          <Switch
            value={extraFlavourEnabled}
            onValueChange={(enabled) => {
              setExtraFlavourEnabled(enabled);
              if (!enabled) {
                setExtraFlavourId('');
                setExtraPlacement('ON_WINGS');
              }
            }}
            trackColor={{ false: '#DDD', true: P.red }}
            thumbColor="#FFF"
          />
        </View>
        {extraFlavourEnabled && !loading && !error ? (
          <ExtraFlavourPicker
            flavours={flavours}
            selectedFlavourId={extraFlavourId}
            onSelect={(f) => setExtraFlavourId(f.id)}
          />
        ) : null}
      </StepCard>

      {/* ---- Extra flavour placement ---- */}
      {extraFlavourEnabled && !loading && !error ? (
        <StepCard title="Saucing method" subtitle="How to apply your extra sauce.">
          <OptionPills
            options={[
              { value: 'ON_WINGS', label: 'Sauce on wings' },
              { value: 'ON_SIDE', label: 'On the side' },
            ]}
            value={extraPlacement}
            onChange={(v) => setExtraPlacement(v as 'ON_WINGS' | 'ON_SIDE')}
          />
        </StepCard>
      ) : null}

      {/* ---- Wings-4-U Special: Salad selection ---- */}
      {usesChildSaladCustomization ? (
        <StepCard
          title="Salad selection"
          subtitle={
            selectedSaladGroup && selectedSaladGroup.options.length > 0
              ? 'Choose a salad included with your special.'
              : 'Salad options are currently unavailable.'
          }
          invalid={submitAttempted && validationError === 'salad'}
          inlineError={
            submitAttempted && validationError === 'salad'
              ? !selectedSaladGroup || selectedSaladGroup.options.length === 0
                ? 'Salad options are currently unavailable.'
                : 'Please select a salad for your special.'
              : null
          }
        >
          {selectedSaladGroup && selectedSaladGroup.options.length > 0 ? (
            <OptionPills
              options={selectedSaladGroup.options.map((opt) => ({
                value: opt.id,
                label: opt.name,
                priceNote: opt.price_delta_cents > 0 ? `+${formatCents(opt.price_delta_cents)}` : undefined,
              }))}
              value={saladPickerPicks[0] ?? null}
              onChange={(optId) => toggleExtraOption(selectedSaladGroup, optId)}
            />
          ) : (
            <Text style={styles.inlineCopy}>
              Salad customization is required for Wings-4-U Special, but no eligible salads supporting the Small size were found.
            </Text>
          )}
        </StepCard>
      ) : null}

      {/* ---- Wings-4-U Special: Salad ingredient removals ---- */}
      {usesChildSaladCustomization && activeRemovableIngredients.length > 0 ? (
        <StepCard title="Salad ingredient removals" subtitle="Tap items to leave off your salad.">
          <View style={styles.pillWrap}>
            {activeRemovableIngredients.map((ing) => {
              const active = saladRemovedIngredientIds.has(ing.id);
              return (
                <TouchableOpacity
                  key={ing.id}
                  style={[styles.removePill, active && styles.removePillActive]}
                  onPress={() =>
                    setSaladRemovedIngredientIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(ing.id)) next.delete(ing.id);
                      else next.add(ing.id);
                      return next;
                    })
                  }
                >
                  <Text style={[styles.removePillText, active && styles.removePillTextActive]}>
                    {active ? '✕ ' : ''}{ing.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </StepCard>
      ) : null}

      {/* ---- Wings-4-U Special: Salad add-ons ---- */}
      {usesChildSaladCustomization &&
        saladAddonGroups.map((group) => {
          const stepKey = `salad-addon-${group.id}`;
          const picks = saladModifierSelections[group.id] ?? [];
          return (
            <StepCard
              key={`salad-addon-${group.id}`}
              title={normalizeSaladAddonDisplayLabel(group.display_label, group.name)}
              subtitle={group.selection_mode === 'MULTI' ? 'Pick any.' : 'Pick one if you want.'}
              invalid={submitAttempted && validationError === stepKey}
              inlineError={submitAttempted && validationError === stepKey ? BUILDER_VALIDATION_MESSAGE : null}
            >
              <OptionPills
                options={group.options.map((opt) => ({
                  value: opt.id,
                  label: opt.name,
                  priceNote: opt.price_delta_cents > 0 ? `+${formatCents(opt.price_delta_cents)}` : undefined,
                }))}
                multi={group.selection_mode === 'MULTI'}
                value={group.selection_mode === 'SINGLE' ? (picks[0] ?? null) : null}
                values={group.selection_mode === 'MULTI' ? picks : undefined}
                onChange={(optId) => toggleSaladAddonOption(group, optId)}
                onToggle={(optId) => toggleSaladAddonOption(group, optId)}
              />
            </StepCard>
          );
        })}

      {/* ---- Extra modifier groups (pop slot, dip, etc.) ---- */}
      {extraGroupsMinusSalad.map((group) => {
        const stepKey = `extra-${group.id}`;
        const picks = extraGroupSelections[group.id] ?? [];
        const subtitle =
          group.selection_mode === 'MULTI'
            ? group.max_select
              ? `Pick up to ${group.max_select}.`
              : 'Pick any.'
            : group.is_required
              ? 'Pick one.'
              : 'Pick one if you want.';
        return (
          <StepCard
            key={group.id}
            title={group.display_label || group.name}
            subtitle={subtitle}
            invalid={submitAttempted && validationError === stepKey}
            inlineError={submitAttempted && validationError === stepKey ? BUILDER_VALIDATION_MESSAGE : null}
          >
            <OptionPills
              options={group.options.map((opt) => ({
                value: opt.id,
                label: opt.name,
                priceNote: opt.price_delta_cents > 0 ? `+${formatCents(opt.price_delta_cents)}` : undefined,
              }))}
              multi={group.selection_mode === 'MULTI'}
              value={group.selection_mode === 'SINGLE' ? (picks[0] ?? null) : null}
              values={group.selection_mode === 'MULTI' ? picks : undefined}
              onChange={(optId) => toggleExtraOption(group, optId)}
              onToggle={(optId) => toggleExtraOption(group, optId)}
            />
          </StepCard>
        );
      })}

      {/* ---- Removable ingredients ---- */}
      {(item.removable_ingredients?.length ?? 0) > 0 && !usesChildSaladCustomization ? (
        <StepCard title="Ingredient removals" subtitle="Tap items to leave off.">
          <View style={styles.pillWrap}>
            {item.removable_ingredients.map((ing) => {
              const active = removedIngredientIds.has(ing.id);
              return (
                <TouchableOpacity
                  key={ing.id}
                  style={[styles.removePill, active && styles.removePillActive]}
                  onPress={() =>
                    setRemovedIngredientIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(ing.id)) next.delete(ing.id);
                      else next.add(ing.id);
                      return next;
                    })
                  }
                >
                  <Text style={[styles.removePillText, active && styles.removePillTextActive]}>
                    {active ? '✕ ' : ''}{ing.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </StepCard>
      ) : null}

      {/* ---- Special instructions ---- */}
      <StepCard
        title="Special instructions"
        subtitle={
          tellUsHowSaucing && saucingMethod === 'TELL_US_HOW'
            ? 'Describe how you want the sauces applied.'
            : 'Notes for the kitchen.'
        }
        invalid={submitAttempted && validationError === 'instructions'}
        inlineError={submitAttempted && validationError === 'instructions' ? BUILDER_VALIDATION_MESSAGE : null}
      >
        <NotesInput
          value={instructions}
          onChange={setInstructions}
          placeholder={
            tellUsHowSaucing && saucingMethod === 'TELL_US_HOW'
              ? 'e.g. one flavour per section, two on the side…'
              : 'Anything we should know?'
          }
        />
      </StepCard>
    </MobileBuilderShell>
  );
}

const styles = StyleSheet.create({
  inlineCopy: {
    fontSize: 13,
    color: P.muted,
  },
  errorCopy: {
    color: P.red,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: P.text,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flex: 1,
    fontSize: 14,
    color: P.text,
    marginRight: 12,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  removePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: P.border,
    backgroundColor: P.card,
  },
  removePillActive: {
    backgroundColor: 'rgba(229,60,60,0.08)',
    borderColor: P.red,
  },
  removePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: P.text,
  },
  removePillTextActive: {
    color: P.red,
    textDecorationLine: 'line-through',
  },
  errorBanner: {
    gap: 8,
    alignItems: 'flex-start',
  },
  retryBtn: {
    backgroundColor: P.peach,
    borderWidth: 1,
    borderColor: P.peachBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryBtnText: {
    color: P.red,
    fontWeight: '700',
    fontSize: 13,
  },
  unavailableBanner: {
    backgroundColor: 'rgba(229,60,60,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(229,60,60,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 4,
  },
  unavailableBannerText: {
    color: P.red,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
});
