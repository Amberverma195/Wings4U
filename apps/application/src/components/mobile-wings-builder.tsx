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
  isSaucingMethodValidForCount,
  methodRequiresSideFlavourPick,
  normalizeInitialPreparation,
  resolveSaucingPlacements,
  selectedWingPreparationId,
  type Preparation,
  type WingType,
} from '../lib/wing-builder-logic';
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
};

/* ================================================================== */
/*  WingsBuilderMobile                                                 */
/* ================================================================== */

export function WingsBuilderMobile({ item, visible, onClose, editingLine }: Props) {
  const { addItem, replaceItem } = useCart();
  const { flavours, loading, error } = useWingFlavours(item);

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
    () => editingPayload?.flavour_slots.map((s) => s.wing_flavour_id) ?? [],
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
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [extraGroupSelections, setExtraGroupSelections] = useState<Record<string, string[]>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

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
        setQuantity(1);
        setExtraGroupSelections({});
        setSubmitAttempted(false);
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

  /* Auto-select single weight option */
  useEffect(() => {
    if (!selectedWeightId && weightOptions.length === 1) {
      setSelectedWeightId(weightOptions[0]!.menu_item_id);
    }
  }, [selectedWeightId, weightOptions]);

  /* Resize flavour slots when required count changes */
  useEffect(() => {
    setFlavourSelections((prev) =>
      Array.from({ length: requiredFlavourCount }, (_, i) => prev[i] ?? ''),
    );
  }, [requiredFlavourCount]);

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

  /* Clear plain extra flavour if selected */
  useEffect(() => {
    if (!extraFlavourEnabled || !extraFlavourId) return;
    const picked = flavours.find((f) => f.id === extraFlavourId);
    if (picked?.is_plain) setExtraFlavourId('');
  }, [extraFlavourEnabled, extraFlavourId, flavours]);

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
    setExtraGroupSelections((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOption]);

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

  const liveUnitPrice =
    (selectedOption?.base_price_cents ?? 0) +
    (extraFlavourEnabled ? EXTRA_FLAVOUR_PRICE_CENTS : 0) +
    (wingType === 'BONELESS' ? BONELESS_WINGS_UPCHARGE_CENTS : 0) +
    extraGroupsTotalDelta;

  /* Validation */
  const validate = useCallback((): string | null => {
    if (!selectedOption) return 'quantity';
    if (!wingType || !preparation) return 'preparation';
    if (flavourSelections.some((s) => !s)) return 'flavours';
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
    if (extraFlavourEnabled && !extraFlavourId) return 'extra-flavour';
    for (const group of extraGroups) {
      const picks = extraGroupSelections[group.id] ?? [];
      const min = group.is_required ? Math.max(group.min_select, 1) : group.min_select;
      if (picks.length < min) return `extra-${group.id}`;
    }
    return null;
  }, [
    allMainFlavoursPlain,
    effectiveSaucedCount,
    extraFlavourEnabled,
    extraFlavourId,
    extraGroups,
    extraGroupSelections,
    flavourSelections,
    hasValidSideFlavourSlot,
    instructions,
    partyFiveSpecial,
    preparation,
    requiredFlavourCount,
    saucingMethod,
    selectedOption,
    tellUsHowSaucing,
    threeFlavourTellUsHow,
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
        if (!opt) continue;
        modifierSelections.push({
          modifier_option_id: opt.id,
          group_name: group.name,
          option_name: opt.name,
          price_delta_cents: opt.price_delta_cents,
        });
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
    };

    const removedIngredients: RemovedIngredientSelection[] = item.removable_ingredients
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
    quantity,
    editingLine,
    addItem,
    replaceItem,
    onClose,
  ]);

  const toggleExtraOption = useCallback((group: ModifierGroup, optionId: string) => {
    setExtraGroupSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === 'SINGLE') return { ...prev, [group.id]: [optionId] };
      if (current.includes(optionId)) return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      if (group.max_select && current.length >= group.max_select) return { ...prev, [group.id]: [...current.slice(1), optionId] };
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }, []);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  const submitLabel = editingLine ? 'Save changes' : 'Add to cart';

  return (
    <MobileBuilderShell
      visible={visible}
      title={item.name}
      description={item.description ?? 'Build your wings exactly how you want them.'}
      onClose={onClose}
      quantity={quantity}
      onDecrease={() => setQuantity((v) => Math.max(1, v - 1))}
      onIncrease={() => setQuantity((v) => v + 1)}
      quantityDisabled={!isReadyToSubmit}
      totalCents={liveUnitPrice * quantity}
      submitLabel={submitLabel}
      submitDisabled={!isReadyToSubmit}
      onSubmit={handleAdd}
    >
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
          <Text style={[styles.inlineCopy, styles.errorCopy]}>{error}</Text>
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

      {/* ---- Extra modifier groups (pop slot, etc.) ---- */}
      {extraGroups.map((group) => {
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
              value={group.selection_mode === 'SINGLE' ? (picks[0] ?? null) : null}
              onChange={(optId) => toggleExtraOption(group, optId)}
            />
          </StepCard>
        );
      })}

      {/* ---- Removable ingredients ---- */}
      {item.removable_ingredients.length > 0 && !usesChildSaladCustomization ? (
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
});
