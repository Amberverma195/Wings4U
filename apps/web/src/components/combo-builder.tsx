"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import type {
  BuilderMenuOption,
  CartItem,
  CartModifierSelection,
  MenuItem,
  ModifierGroup,
  WingFlavour,
  WingBuilderPayload,
} from "@/lib/types";
import {
  BUILDER_VALIDATION_MESSAGE,
  BuilderShell,
  builderSubmitLabel,
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
  /**
   * Phase 13: pre-fill from this cart line and replace it on submit.
   */
  editingLine?: CartItem;
};

type WingType = "BONE_IN" | "BONELESS" | null;
type Preparation = "BREADED" | "NON_BREADED" | null;

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

function buildFallbackComboOption(item: MenuItem): BuilderMenuOption {
  const sideGroups = item.modifier_groups.filter((group) => group.context_key === "side");
  const drinkGroups = item.modifier_groups.filter((group) => group.context_key === "drink");
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

function findWingTypeGroup(option: BuilderMenuOption) {
  return option.modifier_groups.find((group) => /wing type/i.test(group.name) || /wing type/i.test(group.display_label));
}

function resolveWingTypeModifier(
  option: BuilderMenuOption,
  wingType: Exclude<WingType, null>,
  preparation: Exclude<Preparation, null>,
): CartModifierSelection | null {
  const group = findWingTypeGroup(option);
  if (!group) return null;

  const selected = group.options.find((optionItem) => {
    const normalized = optionItem.name.toLowerCase();
    if (wingType === "BONELESS") {
      return normalized.includes("boneless");
    }
    if (preparation === "BREADED") {
      return normalized.includes("breaded") && normalized.includes("bone") && !normalized.includes("non");
    }
    return normalized.includes("non") && normalized.includes("breaded") && normalized.includes("bone");
  });

  if (!selected) return null;

  return {
    modifier_option_id: selected.id,
    group_name: group.name,
    option_name: selected.name,
    price_delta_cents: selected.price_delta_cents,
  };
}

export function ComboBuilder({ item, onClose, editingLine }: Props) {
  const { addItem, replaceItem } = useCart();
  const { flavours, loading, error } = useWingFlavours();
  // Phase 13: hydrate initial state from the editing payload when present.
  const editingPayload =
    editingLine?.builder_payload?.builder_type === "WING_COMBO"
      ? (editingLine.builder_payload as WingBuilderPayload)
      : undefined;
  const [selectedComboId, setSelectedComboId] = useState<string | null>(
    editingLine?.menu_item_id ?? null,
  );
  const [wingType, setWingType] = useState<WingType>(
    editingPayload?.wing_type ?? null,
  );
  const [preparation, setPreparation] = useState<Preparation>(
    editingPayload?.preparation ?? null,
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
  const [sideSelections, setSideSelections] = useState<string[]>(
    () => editingPayload?.side_selections ?? [],
  );
  const [drinkSelections, setDrinkSelections] = useState<string[]>(
    () => editingPayload?.drink_selections ?? [],
  );
  const [instructions, setInstructions] = useState(
    editingLine?.special_instructions ?? "",
  );
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const stepRefs = useRef(new Map<string, HTMLElement>());

  const comboOptions = useMemo(
    () => (item.combo_options?.length ? item.combo_options : [buildFallbackComboOption(item)]),
    [item],
  );

  const selectedOption = useMemo(
    () => comboOptions.find((option) => option.menu_item_id === selectedComboId) ?? null,
    [comboOptions, selectedComboId],
  );

  const requiredFlavourCount = selectedOption?.flavour_count ?? 0;
  const sideGroups = selectedOption?.modifier_groups.filter((group) => group.context_key === "side") ?? [];
  const drinkGroups = selectedOption?.modifier_groups.filter((group) => group.context_key === "drink") ?? [];

  useEffect(() => {
    if (!selectedComboId && comboOptions.length === 1) {
      setSelectedComboId(comboOptions[0].menu_item_id);
    }
  }, [comboOptions, selectedComboId]);

  useEffect(() => {
    setFlavourSelections((prev) => Array.from({ length: requiredFlavourCount }, (_, index) => prev[index] ?? ""));
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

  // Default the saucing method to the PRD-recommended option for the
  // current effective sauce count, and clear the side-flavour pick if the active
  // method no longer needs it.
  useEffect(() => {
    setSaucingMethod((prev) => {
      if (
        isSaucingMethodValidForCount(
          effectiveSaucedCount,
          prev,
          false,
          requiredFlavourCount,
        )
      ) {
        return prev;
      }
      return defaultSaucingMethodForCount(
        effectiveSaucedCount,
        false,
        requiredFlavourCount,
      );
    });
  }, [effectiveSaucedCount, requiredFlavourCount]);

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
    setSideSelections((prev) => Array.from({ length: sideGroups.length }, (_, index) => prev[index] ?? ""));
  }, [sideGroups.length]);

  useEffect(() => {
    setDrinkSelections((prev) => Array.from({ length: drinkGroups.length }, (_, index) => prev[index] ?? ""));
  }, [drinkGroups.length]);

  useEffect(() => {
    if (wingType === "BONELESS") {
      setPreparation(null);
    }
  }, [wingType]);

  const resolvedPreparation = preparation;
  const liveUnitPrice = selectedOption?.base_price_cents ?? 0;
  const showsSaucingStep = requiredFlavourCount >= 1 && !allMainFlavoursPlain;

  const steps = useMemo(() => {
    const completion = [
      { id: "combo-size", label: "Combo size", complete: selectedOption !== null },
      { id: "wing-type", label: "Wing type", complete: wingType !== null },
      { id: "preparation", label: "Preparation", complete: preparation !== null },
      { id: "flavours", label: "Flavours", complete: requiredFlavourCount > 0 && flavourSelections.every(Boolean) },
      ...(showsSaucingStep
        ? [
            {
              id: "saucing",
              label: "Saucing",
              complete:
                isSaucingMethodValidForCount(
                  effectiveSaucedCount,
                  saucingMethod,
                  false,
                  requiredFlavourCount,
                ) &&
                (!methodRequiresSideFlavourPick(
                  effectiveSaucedCount,
                  saucingMethod,
                ) ||
                  hasValidSideFlavourSlot),
            },
          ]
        : []),
      { id: "sides", label: "Sides", complete: sideSelections.length === sideGroups.length && sideSelections.every(Boolean) },
      { id: "drinks", label: "Drinks", complete: drinkSelections.length === drinkGroups.length && drinkSelections.every(Boolean) },
      { id: "instructions", label: "Instructions", complete: true },
    ];

    const firstIncomplete = completion.find((step) => !step.complete)?.id;
    return completion.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.complete ? "complete" as const : firstIncomplete === step.id ? "active" as const : "pending" as const,
    }));
  }, [
    allMainFlavoursPlain,
    drinkGroups.length,
    drinkSelections,
    effectiveSaucedCount,
    flavourSelections,
    hasValidSideFlavourSlot,
    preparation,
    requiredFlavourCount,
    saucingMethod,
    selectedOption,
    showsSaucingStep,
    sideFlavourSlot,
    sideGroups.length,
    sideSelections,
    wingType,
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

  const validate = useCallback(() => {
    if (!selectedOption) return "combo-size";
    if (!wingType) return "wing-type";
    if (!resolvedPreparation) return "preparation";
    if (flavourSelections.some((selection) => !selection)) return "flavours";
    if (!allMainFlavoursPlain) {
      if (
        !isSaucingMethodValidForCount(
          effectiveSaucedCount,
          saucingMethod,
          false,
          requiredFlavourCount,
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
    if (sideSelections.some((selection) => !selection)) return "sides";
    if (drinkSelections.some((selection) => !selection)) return "drinks";
    return null;
  }, [
    allMainFlavoursPlain,
    drinkSelections,
    effectiveSaucedCount,
    flavourSelections,
    hasValidSideFlavourSlot,
    requiredFlavourCount,
    resolvedPreparation,
    saucingMethod,
    selectedOption,
    sideFlavourSlot,
    sideSelections,
    wingType,
  ]);

  const validationError = useMemo(() => validate(), [validate]);
  const isReadyToSubmit = validationError === null;

  // Auto-dismiss the validation banner once every required field is satisfied.
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
          false,
          requiredFlavourCount,
        )
        ? saucingMethod
        : defaultSaucingMethodForCount(
            effectiveSaucedCount,
            false,
            requiredFlavourCount,
          );

    const modifierSelections: CartModifierSelection[] = [];
    const wingTypeSelection = resolveWingTypeModifier(selectedOption, wingType, resolvedPreparation);
    if (wingTypeSelection) {
      modifierSelections.push(wingTypeSelection);
    }

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
        placement: placements[index] ?? "ON_WINGS",
      };
    });

    const builderPayload: WingBuilderPayload = {
      builder_type: "WING_COMBO",
      wing_type: wingType,
      preparation: resolvedPreparation,
      weight_lb: selectedOption.weight_lb,
      flavour_slots: flavourSlots,
      saucing_method: resolvedSaucingMethod ?? undefined,
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
      description={item.description ?? "Build your combo with wings, sides, and drinks."}
      onClose={onClose}
      closeAriaLabel="Close combo builder"
      steps={steps}
      quantity={quantity}
      onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
      onIncrease={() => setQuantity((value) => value + 1)}
      quantityDisabled={!isReadyToSubmit}
      totalCents={liveUnitPrice * quantity}
      submitLabel={builderSubmitLabel(Boolean(editingLine))}
      onSubmit={handleAdd}
    >
          <StepContainer
            title="Combo size"
            subtitle="Choose your combo size (pounds)."
            invalid={submitAttempted && validationError === "combo-size"}
            inlineError={
              submitAttempted && validationError === "combo-size"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("combo-size", node)}
          >
            <div className="builder-option-pills">
              {comboOptions.map((option) => (
                <button
                  key={option.menu_item_id}
                  type="button"
                  className={`builder-option-pill${selectedComboId === option.menu_item_id ? " builder-option-pill-active" : ""}`}
                  onClick={() => setSelectedComboId(option.menu_item_id)}
                >
                  {option.weight_lb} lb / {option.flavour_count} flavour
                  {option.flavour_count === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          </StepContainer>

          <StepContainer
            title="Wing type"
            subtitle="Choose bone-in or boneless."
            invalid={submitAttempted && validationError === "wing-type"}
            inlineError={
              submitAttempted && validationError === "wing-type"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("wing-type", node)}
          >
            <div className="builder-option-pills">
              <button
                type="button"
                className={`builder-option-pill${wingType === "BONE_IN" ? " builder-option-pill-active" : ""}`}
                onClick={() => setWingType("BONE_IN")}
              >
                Bone-in
              </button>
              <button
                type="button"
                className={`builder-option-pill${wingType === "BONELESS" ? " builder-option-pill-active" : ""}`}
                onClick={() => setWingType("BONELESS")}
              >
                Boneless
              </button>
            </div>
          </StepContainer>

          <StepContainer
            title="Preparation"
            subtitle={wingType === "BONELESS" ? "Boneless wings are non-breaded. Tap to confirm." : "Choose breaded or non-breaded."}
            invalid={submitAttempted && validationError === "preparation"}
            inlineError={
              submitAttempted && validationError === "preparation"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("preparation", node)}
          >
            <div className="builder-option-pills">
              {wingType !== "BONELESS" && (
                <button
                  type="button"
                  className={`builder-option-pill${preparation === "BREADED" ? " builder-option-pill-active" : ""}`}
                  onClick={() => setPreparation("BREADED")}
                >
                  Breaded
                </button>
              )}
              <button
                type="button"
                className={`builder-option-pill${preparation === "NON_BREADED" ? " builder-option-pill-active" : ""}`}
                onClick={() => setPreparation("NON_BREADED")}
              >
                Non-breaded
              </button>
            </div>
          </StepContainer>

          <StepContainer
            title="Flavours"
            subtitle={requiredFlavourCount > 0 ? `Choose ${requiredFlavourCount} flavour${requiredFlavourCount === 1 ? "" : "s"}.` : "Select a combo size first to unlock flavours."}
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
                  <div key={`combo-slot-${index + 1}`} className="builder-slot-block">
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
                  : "Choose how the flavours should be distributed."
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
                onChange={setSaucingMethod}
                sideFlavourOptions={sideFlavourOptions}
                sideFlavourSlot={sideFlavourSlot}
                onSideFlavourSlotChange={setSideFlavourSlot}
              />
            </StepContainer>
          ) : null}

          <StepContainer
            title="Side selection"
            subtitle="Each combo size defines how many sides are required."
            invalid={submitAttempted && validationError === "sides"}
            inlineError={
              submitAttempted && validationError === "sides"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("sides", node)}
          >
            <div className="builder-slot-stack">
              {sideGroups.map((group, index) => (
                <div key={group.id} className="builder-slot-block">
                  <h4>{group.display_label || group.name}</h4>
                  <div className="builder-option-pills">
                    {group.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`builder-option-pill${sideSelections[index] === option.id ? " builder-option-pill-active" : ""}`}
                        onClick={() =>
                          setSideSelections((prev) => {
                            const next = [...prev];
                            next[index] = option.id;
                            return next;
                          })
                        }
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </StepContainer>

          <StepContainer
            title="Drink selection"
            subtitle="Choose the included drinks for this combo."
            invalid={submitAttempted && validationError === "drinks"}
            inlineError={
              submitAttempted && validationError === "drinks"
                ? BUILDER_VALIDATION_MESSAGE
                : null
            }
            ref={(node) => setStepRef("drinks", node)}
          >
            <div className="builder-slot-stack">
              {drinkGroups.map((group, index) => (
                <div key={group.id} className="builder-slot-block">
                  <h4>{group.display_label || group.name}</h4>
                  <div className="builder-option-pills">
                    {group.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`builder-option-pill${drinkSelections[index] === option.id ? " builder-option-pill-active" : ""}`}
                        onClick={() =>
                          setDrinkSelections((prev) => {
                            const next = [...prev];
                            next[index] = option.id;
                            return next;
                          })
                        }
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </StepContainer>

          <StepContainer
            title="Special instructions"
            ref={(node) => setStepRef("instructions", node)}
          >
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
