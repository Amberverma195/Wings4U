/**
 * mobile-combo-builder.tsx
 *
 * Mobile Wing Combo builder with 1:1 functional parity with the
 * website's ComboBuilder component (apps/web/src/components/combo-builder.tsx).
 *
 * Implements:
 *  - Combo size selection (pounds + flavours per size)
 *  - Wing Preparation (Breaded Bone-In / Non-Breaded Bone-In / Breaded-Boneless +$1.00)
 *  - Multi-slot Flavour selection with heat-level tabs
 *  - Saucing method distribution rules (half/half, side, split, mixed, tell-us-how)
 *  - Side selection (mandatory per combo side slot)
 *  - Drink selection (mandatory per combo drink slot)
 *  - Kitchen instructions & tell-us-how saucing note
 *  - Cart line editing (hydration + replaceItem)
 *  - 1:1 WingBuilderPayload schema
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCart } from '../context/cart';
import type {
  BuilderMenuOption,
  CartItem,
  CartModifierSelection,
  MenuItem,
  ModifierGroup,
  WingBuilderPayload,
  WingFlavour,
} from '../lib/types';
import {
  BONELESS_WINGS_UPCHARGE_CENTS,
  WING_PREPARATION_OPTIONS,
  areAllSelectedFlavoursPlain,
  countEffectiveSaucedFlavours,
  defaultSaucingMethodForCount,
  extractWeightLb,
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
/*  Helpers (matching web combo-builder.tsx)                           */
/* ------------------------------------------------------------------ */

function countFlavourGroups(groups: ModifierGroup[]) {
  return groups.filter((group) =>
    group.options.some((option) => option.linked_flavour_id),
  ).length;
}

function buildFallbackComboOption(item: MenuItem): BuilderMenuOption {
  const sideGroups = item.modifier_groups.filter(
    (group) => group.context_key === 'side',
  );
  const drinkGroups = item.modifier_groups.filter(
    (group) => group.context_key === 'drink',
  );
  return {
    menu_item_id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    base_price_cents: item.base_price_cents,
    weight_lb: extractWeightLb(item.name),
    flavour_count: countFlavourGroups(item.modifier_groups),
    side_slot_count: sideGroups.length,
    drink_slot_count: drinkGroups.length,
    modifier_groups: item.modifier_groups,
  };
}

function findWingTypeGroup(option: BuilderMenuOption): ModifierGroup | undefined {
  return option.modifier_groups.find(
    (group) =>
      /wing type/i.test(group.name) || /wing type/i.test(group.display_label),
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
      if (wingType === 'BONELESS') {
        return normalized.includes('boneless');
      }
      if (preparation === 'BREADED') {
        return (
          normalized.includes('breaded') &&
          normalized.includes('bone') &&
          !normalized.includes('non')
        );
      }
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
/*  ComboBuilderMobile                                                */
/* ================================================================== */

export function ComboBuilderMobile({
  item,
  visible,
  onClose,
  editingLine,
}: Props) {
  const { addItem, replaceItem } = useCart();
  const { flavours, loading, error } = useWingFlavours(item);

  const editingPayload =
    editingLine?.builder_payload?.builder_type === 'WING_COMBO'
      ? (editingLine.builder_payload as WingBuilderPayload)
      : undefined;

  const comboOptions = useMemo(
    () =>
      item.combo_options?.length
        ? item.combo_options
        : [buildFallbackComboOption(item)],
    [item],
  );
  const showComboSizeStep = comboOptions.length > 1;

  /* State */
  const [selectedComboId, setSelectedComboId] = useState<string | null>(
    editingLine?.menu_item_id ?? null,
  );
  const initialWingType = editingPayload?.wing_type ?? null;
  const [wingType, setWingType] = useState<WingType>(initialWingType);
  const [preparation, setPreparation] = useState<Preparation>(
    normalizeInitialPreparation(
      initialWingType,
      editingPayload?.preparation ?? null,
    ),
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
  const [sideSelections, setSideSelections] = useState<string[]>(
    () => editingPayload?.side_selections ?? [],
  );
  const [drinkSelections, setDrinkSelections] = useState<string[]>(
    () => editingPayload?.drink_selections ?? [],
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
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  /* Reset on open */
  const prevVisible = useRef(false);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      if (!editingLine) {
        setSelectedComboId(null);
        setWingType(null);
        setPreparation(null);
        setFlavourSelections([]);
        setSaucingMethod(null);
        setSideFlavourSlot(null);
        setSideSelections([]);
        setDrinkSelections([]);
        setInstructions('');
        setQuantity(1);
        setSubmitAttempted(false);
      }
    }
    prevVisible.current = visible;
  }, [visible, editingLine]);

  /* Derived combo option & slots */
  const selectedOption = useMemo(
    () =>
      comboOptions.find((option) => option.menu_item_id === selectedComboId) ??
      null,
    [comboOptions, selectedComboId],
  );

  const requiredFlavourCount = selectedOption?.flavour_count ?? 0;
  const threeFlavourTellUsHow = requiredFlavourCount === 3;
  const tellUsHowSaucing = threeFlavourTellUsHow;

  const sideGroups = useMemo(
    () =>
      selectedOption?.modifier_groups.filter(
        (group) => group.context_key === 'side',
      ) ?? [],
    [selectedOption],
  );
  const drinkGroups = useMemo(
    () =>
      selectedOption?.modifier_groups.filter(
        (group) => group.context_key === 'drink',
      ) ?? [],
    [selectedOption],
  );

  /* Auto-select single combo option */
  useEffect(() => {
    if (!selectedComboId && comboOptions.length === 1) {
      setSelectedComboId(comboOptions[0]!.menu_item_id);
    }
  }, [comboOptions, selectedComboId]);

  /* Resize flavour slots when required count changes */
  useEffect(() => {
    setFlavourSelections((prev) =>
      Array.from({ length: requiredFlavourCount }, (_, index) => prev[index] ?? ''),
    );
  }, [requiredFlavourCount]);

  /* Resize side & drink selections when group counts change */
  useEffect(() => {
    setSideSelections((prev) =>
      Array.from({ length: sideGroups.length }, (_, index) => prev[index] ?? ''),
    );
  }, [sideGroups.length]);

  useEffect(() => {
    setDrinkSelections((prev) =>
      Array.from({ length: drinkGroups.length }, (_, index) => prev[index] ?? ''),
    );
  }, [drinkGroups.length]);

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

  /* Auto-adjust saucing method */
  useEffect(() => {
    setSaucingMethod((prev) => {
      if (
        isSaucingMethodValidForCount(
          effectiveSaucedCount,
          prev,
          false,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
      ) {
        return prev;
      }
      return defaultSaucingMethodForCount(
        effectiveSaucedCount,
        false,
        requiredFlavourCount,
        threeFlavourTellUsHow,
      );
    });
  }, [effectiveSaucedCount, requiredFlavourCount, threeFlavourTellUsHow]);

  /* Clear side flavour slot if not needed */
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

  /* Pricing */
  const liveUnitPrice =
    (selectedOption?.base_price_cents ?? 0) +
    (wingType === 'BONELESS' ? BONELESS_WINGS_UPCHARGE_CENTS : 0);

  const showsSaucingStep = requiredFlavourCount >= 1 && !allMainFlavoursPlain;

  /* Validation */
  const validate = useCallback((): string | null => {
    if (!selectedOption) return 'combo-size';
    if (!wingType || !preparation) return 'preparation';
    if (flavourSelections.some((selection) => !selection)) return 'flavours';
    if (!allMainFlavoursPlain) {
      if (
        !isSaucingMethodValidForCount(
          effectiveSaucedCount,
          saucingMethod,
          false,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
      ) {
        return requiredFlavourCount >= 1 ? 'saucing' : null;
      }
      if (
        methodRequiresSideFlavourPick(effectiveSaucedCount, saucingMethod) &&
        !hasValidSideFlavourSlot
      ) {
        return 'saucing';
      }
    }
    if (
      tellUsHowSaucing &&
      saucingMethod === 'TELL_US_HOW' &&
      !instructions.trim()
    ) {
      return 'instructions';
    }
    if (sideSelections.some((selection) => !selection)) return 'sides';
    if (drinkSelections.some((selection) => !selection)) return 'drinks';
    return null;
  }, [
    selectedOption,
    wingType,
    preparation,
    flavourSelections,
    allMainFlavoursPlain,
    effectiveSaucedCount,
    saucingMethod,
    requiredFlavourCount,
    threeFlavourTellUsHow,
    hasValidSideFlavourSlot,
    tellUsHowSaucing,
    instructions,
    sideSelections,
    drinkSelections,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  /* Auto-dismiss banner once ready */
  useEffect(() => {
    if (submitAttempted && isReadyToSubmit) setSubmitAttempted(false);
  }, [submitAttempted, isReadyToSubmit]);

  /* Handle add to cart */
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
          false,
          requiredFlavourCount,
          threeFlavourTellUsHow,
        )
        ? saucingMethod
        : defaultSaucingMethodForCount(
            effectiveSaucedCount,
            false,
            requiredFlavourCount,
            threeFlavourTellUsHow,
          );

    const modifierSelections: CartModifierSelection[] = [];
    const wingTypeSelection = resolveWingTypeModifier(
      selectedOption,
      wingType,
      preparation,
    );
    if (wingTypeSelection) modifierSelections.push(wingTypeSelection);

    sideGroups.forEach((group, index) => {
      const optionId = sideSelections[index];
      const option = group.options.find((candidate) => candidate.id === optionId);
      if (option) {
        modifierSelections.push({
          modifier_option_id: option.id,
          group_name: group.name,
          option_name: option.name,
          price_delta_cents: option.price_delta_cents,
        });
      }
    });

    drinkGroups.forEach((group, index) => {
      const optionId = drinkSelections[index];
      const option = group.options.find((candidate) => candidate.id === optionId);
      if (option) {
        modifierSelections.push({
          modifier_option_id: option.id,
          group_name: group.name,
          option_name: option.name,
          price_delta_cents: option.price_delta_cents,
        });
      }
    });

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

    const builderPayload: WingBuilderPayload = {
      builder_type: 'WING_COMBO',
      wing_type: wingType,
      preparation,
      weight_lb: selectedOption.weight_lb,
      flavour_slots: flavourSlots,
      saucing_method: resolvedSaucingMethod ?? undefined,
      saucing_customer_note:
        tellUsHowSaucing &&
        resolvedSaucingMethod === 'TELL_US_HOW' &&
        instructions.trim()
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
      side_selections: sideSelections,
      drink_selections: drinkSelections,
    };

    const incoming = {
      menu_item_id: selectedOption.menu_item_id,
      menu_item_slug: selectedOption.slug,
      name: selectedOption.name,
      image_url: item.image_url,
      base_price_cents: selectedOption.base_price_cents,
      quantity,
      modifier_selections: modifierSelections,
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
    requiredFlavourCount,
    threeFlavourTellUsHow,
    sideGroups,
    sideSelections,
    drinkGroups,
    drinkSelections,
    flavourSelections,
    flavourMap,
    sideFlavourSlot,
    hasValidSideFlavourSlot,
    tellUsHowSaucing,
    instructions,
    item.image_url,
    quantity,
    editingLine,
    replaceItem,
    addItem,
    onClose,
  ]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  const submitLabel = editingLine ? 'Save changes' : 'Add to cart';

  return (
    <MobileBuilderShell
      visible={visible}
      title={item.name}
      description={
        item.description ?? 'Build your combo with wings, sides, and drinks.'
      }
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
      {/* ---- Combo size ---- */}
      {showComboSizeStep ? (
        <StepCard
          title="Combo size"
          subtitle="Choose your combo size (pounds)."
          invalid={submitAttempted && validationError === 'combo-size'}
          inlineError={
            submitAttempted && validationError === 'combo-size'
              ? BUILDER_VALIDATION_MESSAGE
              : null
          }
        >
          <OptionPills
            options={comboOptions.map((opt) => ({
              value: opt.menu_item_id,
              label: `${opt.weight_lb} lb / ${opt.flavour_count} flavour${opt.flavour_count === 1 ? '' : 's'}`,
            }))}
            value={selectedComboId}
            onChange={setSelectedComboId}
          />
        </StepCard>
      ) : null}

      {/* ---- Wing Preparation ---- */}
      <StepCard
        title="Wing Preparation"
        subtitle="Choose how the wings should be prepared."
        invalid={submitAttempted && validationError === 'preparation'}
        inlineError={
          submitAttempted && validationError === 'preparation'
            ? BUILDER_VALIDATION_MESSAGE
            : null
        }
      >
        <OptionPills
          options={WING_PREPARATION_OPTIONS.map((opt) => ({
            value: opt.id,
            label: opt.label,
            priceNote: opt.priceNote,
          }))}
          value={selectedWingPreparationId(wingType, preparation)}
          onChange={(optId) => {
            const found = WING_PREPARATION_OPTIONS.find((o) => o.id === optId);
            if (found) {
              setWingType(found.wingType);
              setPreparation(found.preparation);
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
            : 'Select a combo size first to unlock flavours.'
        }
        invalid={submitAttempted && validationError === 'flavours'}
        inlineError={
          submitAttempted && validationError === 'flavours'
            ? BUILDER_VALIDATION_MESSAGE
            : null
        }
      >
        {loading ? (
          <Text style={styles.inlineCopy}>Loading wing flavours...</Text>
        ) : error && flavours.length === 0 ? (
          <Text style={[styles.inlineCopy, styles.errorCopy]}>{error}</Text>
        ) : (
          <View style={{ gap: 14 }}>
            {flavourSelections.map((selection, index) => (
              <View key={`combo-slot-${index + 1}`} style={{ gap: 8 }}>
                <Text style={styles.slotLabel}>Flavour {index + 1}</Text>
                <FlavourPicker
                  flavours={flavours}
                  selectedFlavourId={selection}
                  onSelect={(fl) =>
                    setFlavourSelections((prev) => {
                      const next = [...prev];
                      next[index] = fl.id;
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
              : 'Choose how the flavours should be distributed.'
          }
          invalid={submitAttempted && validationError === 'saucing'}
          inlineError={
            submitAttempted && validationError === 'saucing'
              ? BUILDER_VALIDATION_MESSAGE
              : null
          }
        >
          <SaucingMethodPicker
            effectiveSaucedCount={effectiveSaucedCount}
            slotCount={requiredFlavourCount}
            value={saucingMethod}
            onChange={setSaucingMethod}
            threeFlavourTellUsHow={threeFlavourTellUsHow}
            sideFlavourOptions={sideFlavourOptions}
            sideFlavourSlot={sideFlavourSlot}
            onSideFlavourSlotChange={setSideFlavourSlot}
          />
        </StepCard>
      ) : null}

      {/* ---- Side selection ---- */}
      {sideGroups.length > 0 ? (
        <StepCard
          title="Side selection"
          subtitle="Each combo size defines how many sides are required."
          invalid={submitAttempted && validationError === 'sides'}
          inlineError={
            submitAttempted && validationError === 'sides'
              ? BUILDER_VALIDATION_MESSAGE
              : null
          }
        >
          <View style={{ gap: 14 }}>
            {sideGroups.map((group, index) => (
              <View key={group.id} style={{ gap: 8 }}>
                <Text style={styles.slotLabel}>
                  {group.display_label || group.name}
                </Text>
                <OptionPills
                  options={group.options.map((opt) => ({
                    value: opt.id,
                    label: opt.name,
                    priceNote:
                      opt.price_delta_cents > 0
                        ? `+$${(opt.price_delta_cents / 100).toFixed(2)}`
                        : undefined,
                  }))}
                  value={sideSelections[index] ?? null}
                  onChange={(optId) =>
                    setSideSelections((prev) => {
                      const next = [...prev];
                      next[index] = optId;
                      return next;
                    })
                  }
                />
              </View>
            ))}
          </View>
        </StepCard>
      ) : null}

      {/* ---- Drink selection ---- */}
      {drinkGroups.length > 0 ? (
        <StepCard
          title="Drink selection"
          subtitle="Choose the included drinks for this combo."
          invalid={submitAttempted && validationError === 'drinks'}
          inlineError={
            submitAttempted && validationError === 'drinks'
              ? BUILDER_VALIDATION_MESSAGE
              : null
          }
        >
          <View style={{ gap: 14 }}>
            {drinkGroups.map((group, index) => (
              <View key={group.id} style={{ gap: 8 }}>
                <Text style={styles.slotLabel}>
                  {group.display_label || group.name}
                </Text>
                <OptionPills
                  options={group.options.map((opt) => ({
                    value: opt.id,
                    label: opt.name,
                  }))}
                  value={drinkSelections[index] ?? null}
                  onChange={(optId) =>
                    setDrinkSelections((prev) => {
                      const next = [...prev];
                      next[index] = optId;
                      return next;
                    })
                  }
                />
              </View>
            ))}
          </View>
        </StepCard>
      ) : null}

      {/* ---- Instructions ---- */}
      <StepCard
        title="Special instructions"
        subtitle={
          tellUsHowSaucing && saucingMethod === 'TELL_US_HOW'
            ? 'Describe how you want the sauces applied.'
            : 'Notes for the kitchen.'
        }
        invalid={submitAttempted && validationError === 'instructions'}
        inlineError={
          submitAttempted && validationError === 'instructions'
            ? BUILDER_VALIDATION_MESSAGE
            : null
        }
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
});
