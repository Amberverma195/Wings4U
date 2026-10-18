import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MobileBuilderShell, StepCard, NotesInput, P } from './mobile-builder-shell';
import { customizationCatalog, customerCustomizationInstructions, defaultSelections, validateSelections, modifierTotal as customizationTotal, maximumSelections, SIDE_POP_BUNDLE_SLUGS, SIDE_POP_BUNDLE_PRICE_CENTS, SIDE_POP_SIDES, SIDE_POP_DRINKS } from '@wings4u/customization';
import { useCart } from "../context/cart";
import type {
  BuilderMenuOption,
  CartBuilderPayload,
  CartItem,
  CartModifierSelection,
  ItemCustomizationPayload,
  LunchSpecialPayload,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  RemovedIngredientSelection,
  WingBuilderPayload,
} from "../lib/types";

type BuildableItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  image_url: string | null;
  builder_type: string | null;
  requires_special_instructions: boolean;
  modifier_groups: ModifierGroup[];
  removable_ingredients: MenuItem["removable_ingredients"];
};

type SelectionMap = Record<string, string[]>;

type Props = {
  item: MenuItem | null;
  visible: boolean;
  categories: MenuCategory[];
  onClose: () => void;
  editItem?: CartItem | null;
};

const BONELESS_WINGS_UPCHARGE_CENTS = 100;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function sortedGroups(groups: ModifierGroup[]): ModifierGroup[] {
  return [...groups].sort((a, b) => a.sort_order - b.sort_order);
}

function sortedOptions(options: ModifierOption[]): ModifierOption[] {
  return [...options].sort((a, b) => {
    if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function variantOptions(item: MenuItem | null): BuilderMenuOption[] {
  if (!item) return [];
  if (item.builder_type === "WING_COMBO") return item.combo_options ?? [];
  if (item.builder_type === "WINGS") return item.weight_options ?? [];
  return [];
}

function buildableFromItem(
  item: MenuItem,
  selectedVariant: BuilderMenuOption | null,
): BuildableItem {
  if (!selectedVariant) {
    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      description: item.description,
      base_price_cents: item.base_price_cents,
      image_url: item.image_url,
      builder_type: item.builder_type,
      requires_special_instructions: item.requires_special_instructions,
      modifier_groups: item.modifier_groups,
      removable_ingredients: item.removable_ingredients,
    };
  }

  return {
    id: selectedVariant.menu_item_id,
    slug: selectedVariant.slug,
    name: selectedVariant.name,
    description: selectedVariant.description,
    base_price_cents: selectedVariant.base_price_cents,
    image_url: item.image_url,
    builder_type: item.builder_type,
    requires_special_instructions: item.requires_special_instructions,
    modifier_groups: selectedVariant.modifier_groups,
    removable_ingredients: item.removable_ingredients,
  };
}

const initialSelections = defaultSelections;

function optionById(group: ModifierGroup, optionId: string | undefined) {
  if (!optionId) return null;
  return group.options.find((option) => option.id === optionId) ?? null;
}

function selectedModifierSelections(
  groups: ModifierGroup[],
  selections: SelectionMap,
  options?: { excludeFlavours?: boolean },
): CartModifierSelection[] {
  const result: CartModifierSelection[] = [];
  for (const group of groups) {
    if (options?.excludeFlavours && isFlavourGroup(group)) continue;
    for (const optionId of selections[group.id] ?? []) {
      const option = optionById(group, optionId);
      if (!option) continue;
      result.push({
        modifier_option_id: option.id,
        group_name: group.name,
        option_name: option.name,
        price_delta_cents: option.price_delta_cents,
      });
    }
  }
  return result;
}

function isFlavourGroup(group: ModifierGroup): boolean {
  return group.options.some((option) => Boolean(option.linked_flavour_id));
}

function isWingTypeGroup(group: ModifierGroup): boolean {
  const label = `${group.name} ${group.display_label}`.toLowerCase();
  return label.includes("wing type") || group.options.some((option) => {
    const name = option.name.toLowerCase();
    return name.includes("bone-in") || name.includes("boneless");
  });
}

function isWingBuilder(item: BuildableItem): boolean {
  return item.builder_type === "WINGS" || item.builder_type === "WING_COMBO";
}

function isLunchChildBuilder(item: MenuItem): boolean {
  return item.slug === "lunch-burger" || item.slug === "lunch-wrap";
}

function parseWeightFromName(name: string): number {
  const match = name.match(/(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
  if (!match) return 1;
  const parsed = Number.parseFloat(match[1] ?? "1");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function resolveWingType(option: ModifierOption | null): WingBuilderPayload["wing_type"] {
  return option?.name.toLowerCase().includes("boneless") ? "BONELESS" : "BONE_IN";
}

function resolvePreparation(option: ModifierOption | null): WingBuilderPayload["preparation"] {
  return option?.name.toLowerCase().includes("non-breaded") ? "NON_BREADED" : "BREADED";
}

function groupsByContext(groups: ModifierGroup[], context: string): ModifierGroup[] {
  return sortedGroups(
    groups.filter((group) => {
      if (group.context_key === context) return true;
      const label = `${group.name} ${group.display_label}`.toLowerCase();
      return label.includes(context);
    }),
  );
}

const validationMessage = validateSelections;

function selectedRemovedIngredients(
  item: BuildableItem | MenuItem,
  removedIds: Set<string>,
): RemovedIngredientSelection[] {
  return item.removable_ingredients
    .filter((ingredient) => removedIds.has(ingredient.id))
    .map((ingredient) => ({ id: ingredient.id, name: ingredient.name }));
}

function lunchChildren(categories: MenuCategory[], item: MenuItem | null): MenuItem[] {
  if (!item) return [];
  const categorySlug = item.slug === "lunch-burger" ? "burgers" : "wraps";
  return categories.find((category) => category.slug === categorySlug)?.items.filter(child => !/-side-add$/i.test(child.slug) && !/side\s*&\s*pop/i.test(child.name)) ?? [];
}

function addSpecialInstructions(
  base: string,
  child: MenuItem,
  removed: RemovedIngredientSelection[],
  addons: LunchSpecialPayload["child_addons"],
): string {
  const parts = [child.name];
  if (removed.length) {
    parts.push(`No ${removed.map((ingredient) => ingredient.name).join(", ")}`);
  }
  if (addons.length) {
    parts.push(`Add ${addons.map((addon) => addon.name).join(", ")}`);
  }
  if (base.trim()) parts.push(base.trim());
  return parts.join(" | ");
}

export function MenuItemBuilder({ item, visible, categories, onClose, editItem = null }: Props) {
  const cart = useCart();
  const initializedSession = useRef('');
  const initializedBuildable = useRef('');
  const initializedChild = useRef('');
  const variants = useMemo(() => variantOptions(item), [item]);
  const [variantId, setVariantId] = useState<string | null>(null);
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.menu_item_id === variantId) ?? null,
    [variantId, variants],
  );
  const buildable = useMemo(
    () => (item ? buildableFromItem(item, selectedVariant) : null),
    [item, selectedVariant],
  );
  const [selections, setSelections] = useState<SelectionMap>({});
  const [childSelections, setChildSelections] = useState<SelectionMap>({});
  const [childId, setChildId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [childRemovedIds, setChildRemovedIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [bundleEnabled, setBundleEnabled] = useState(false);
  const [bundleSide, setBundleSide] = useState<string>(SIDE_POP_SIDES[0]);
  const [bundleDrink, setBundleDrink] = useState<string>(SIDE_POP_DRINKS[0]);

  const childItems = useMemo(() => lunchChildren(categories, item), [categories, item]);
  const selectedChild = useMemo(
    () => childItems.find((child) => child.id === childId) ?? null,
    [childId, childItems],
  );

  useEffect(() => {
    if (!visible || !item) { initializedSession.current = ''; initializedBuildable.current = ''; return; }
    const session = item.id + ':' + (editItem?.key ?? 'new');
    if (initializedSession.current === session) return;
    initializedSession.current = session;
    initializedBuildable.current = '';
    initializedChild.current = '';
    const nextVariants = variantOptions(item);
    setVariantId(nextVariants.find(variant => variant.menu_item_id === editItem?.menu_item_id)?.menu_item_id ?? nextVariants[0]?.menu_item_id ?? null);
    setQuantity(editItem?.quantity ?? 1);
    const savedNotes = editItem?.special_instructions ?? '';
    const lunchPayload = editItem?.builder_payload?.builder_type === 'LUNCH_SPECIAL' ? editItem.builder_payload : null;
    setNotes(customerCustomizationInstructions(savedNotes, editItem?.name ?? item.name, editItem?.builder_payload));
    setSubmitted(false);
    setReviewed(false);
    const payload = editItem?.builder_payload;
    const bundle = payload?.builder_type === 'ITEM_CUSTOMIZATION' ? payload.side_pop_bundle : undefined;
    setBundleEnabled(Boolean(bundle));
    setBundleSide(bundle?.side_label ?? SIDE_POP_SIDES[0]);
    setBundleDrink(bundle?.pop_label ?? SIDE_POP_DRINKS[0]);
    setRemovedIds(new Set(editItem?.removed_ingredients?.map(ingredient => ingredient.id) ?? []));
    setChildRemovedIds(new Set(lunchPayload?.removed_ingredients.map(row => row.id) ?? []));
    setChildId(lunchPayload?.child_menu_item_id ?? null);
  }, [categories, item, visible, editItem]);

  useEffect(() => {
    if (!buildable || !visible) return;
    const key = buildable.id + ':' + (editItem?.key ?? 'new');
    if (initializedBuildable.current === key) return;
    initializedBuildable.current = key;
    const defaults = defaultSelections(buildable.modifier_groups);
    const groups = isWingBuilder(buildable) ? sortedGroups(buildable.modifier_groups) : customizationCatalog(buildable, defaults).groups;
    const initial = initialSelections(groups);
    if (editItem && editItem.menu_item_id === buildable.id) {
      for (const group of groups) {
        initial[group.id] = [];
        const selected = group.options.filter(option => editItem.modifier_selections.some(selection =>
          selection.modifier_option_id === option.id));
        if (selected.length) initial[group.id] = selected.map(option => option.id);
      }
      const payload = editItem.builder_payload;
      if (payload?.builder_type === 'WINGS' || payload?.builder_type === 'WING_COMBO') {
        groups.filter(isFlavourGroup).forEach((group, index) => {
          const flavour = payload.flavour_slots.find(slot => slot.slot_no === index + 1);
          const option = group.options.find(option => option.linked_flavour_id === flavour?.wing_flavour_id);
          if (option) initial[group.id] = [option.id];
        });
      }
    }
    setSelections(initial);
  }, [buildable, editItem, visible]);

  useEffect(() => {
    if (!selectedChild) {
      setChildSelections({});
      return;
    }
    const childKey = selectedChild.id + ':' + (editItem?.key ?? 'new');
    if (initializedChild.current === childKey) return;
    initializedChild.current = childKey;
    const childGroups = customizationCatalog(selectedChild).groups.filter(group => group.context_key === 'addon');
    const payload = editItem?.builder_payload;
    const saved = payload?.builder_type === 'LUNCH_SPECIAL' && payload.child_menu_item_id === selectedChild.id ? payload : null;
    setChildSelections(saved ? Object.fromEntries(childGroups.map(group => [group.id, group.options.filter(option => saved.child_addons.some(row => row.modifier_option_id === option.id)).map(option => option.id)])) : initialSelections(childGroups));
    if (!saved) setChildRemovedIds(new Set());
  }, [selectedChild, editItem]);

  if (!item || !buildable) return null;

  const catalog = customizationCatalog(buildable, selections);
  const groups = isWingBuilder(buildable) ? sortedGroups(buildable.modifier_groups) : catalog.groups;
  const wingBuilder = isWingBuilder(buildable);
  const lunchBuilder = isLunchChildBuilder(item);
  const flavourGroups = groups.filter(isFlavourGroup);
  const wingTypeGroup = groups.find(isWingTypeGroup) ?? null;
  const childCatalog = selectedChild ? customizationCatalog(selectedChild, childSelections) : null;
  const childAddonGroups = childCatalog?.groups.filter(group => group.context_key === 'addon') ?? [];
  const bundleEligible = SIDE_POP_BUNDLE_SLUGS.has(item.slug);
  const reviewMessage = !reviewed && editItem && !wingBuilder && (
    editItem.base_price_cents !== buildable.base_price_cents ||
    (editItem.builder_payload?.builder_type === 'ITEM_CUSTOMIZATION' && editItem.builder_payload.side_pop_bundle && (!bundleEligible || editItem.builder_payload.side_pop_bundle.price_cents !== SIDE_POP_BUNDLE_PRICE_CENTS)) ||
    editItem.modifier_selections.some(saved => !groups.some(group => group.options.some(option => option.id === saved.modifier_option_id && option.price_delta_cents === saved.price_delta_cents))) ||
    [...removedIds].some(id => !buildable.removable_ingredients.some(row => row.id === id)) ||
    (lunchBuilder && editItem.builder_payload?.builder_type === 'LUNCH_SPECIAL' && (
      editItem.builder_payload.child_menu_item_id !== selectedChild?.id ||
      editItem.builder_payload.child_addons.some(saved => !childAddonGroups.some(group => group.options.some(option => option.id === saved.modifier_option_id && option.price_delta_cents === saved.price_delta_cents))) ||
      editItem.builder_payload.removed_ingredients.some(saved => !selectedChild?.removable_ingredients.some(row => row.id === saved.id))
    ))) ? 'Menu options or prices changed. Review the current choices before updating your cart.' : null;
  const invalidSelection = validationMessage(groups, selections);
  const childSelectionError = validationMessage(childAddonGroups, childSelections);
  const staleSelection = [invalidSelection, childSelectionError].find(error => error?.startsWith('Menu options changed')) ||
    ([...removedIds].some(id => !buildable.removable_ingredients.some(row => row.id === id)) ||
     [...childRemovedIds].some(id => !selectedChild?.removable_ingredients.some(row => row.id === id)) ? 'Menu ingredients changed. Review your removals.' : null);
  const unavailable = !item.is_available || item.stock_status === 'UNAVAILABLE' ||
    (item.allowed_fulfillment_type !== 'BOTH' && item.allowed_fulfillment_type !== cart.fulfillmentType);
  const configError = [...catalog.issues, ...(childCatalog?.issues ?? [])].find(issue => issue.kind !== 'duplicate')?.message;
  const reviewChoices = () => {
    if (!bundleEligible) setBundleEnabled(false);
    setSelections(Object.fromEntries(groups.map(group => [group.id, (selections[group.id] ?? []).filter(id => group.options.some(option => option.id === id))])));
    setChildSelections(Object.fromEntries(childAddonGroups.map(group => [group.id, (childSelections[group.id] ?? []).filter(id => group.options.some(option => option.id === id))])));
    setRemovedIds(new Set([...removedIds].filter(id => buildable.removable_ingredients.some(row => row.id === id))));
    setChildRemovedIds(new Set([...childRemovedIds].filter(id => selectedChild?.removable_ingredients.some(row => row.id === id))));
    setReviewed(true);
  };

  const selectedWingOption = wingTypeGroup
    ? optionById(wingTypeGroup, selections[wingTypeGroup.id]?.[0])
    : null;
  const unitTotal =
    buildable.base_price_cents +
    customizationTotal(groups, selections) +
    (bundleEligible && bundleEnabled ? SIDE_POP_BUNDLE_PRICE_CENTS : 0) +
    (wingBuilder && resolveWingType(selectedWingOption) === "BONELESS"
      ? BONELESS_WINGS_UPCHARGE_CENTS
      : 0) +
    (lunchBuilder && selectedChild
      ? customizationTotal(childAddonGroups, childSelections)
      : 0);

  const validate = (): string | null => {
    if (!item.is_available || item.stock_status === 'UNAVAILABLE' ||
      (item.allowed_fulfillment_type !== 'BOTH' && item.allowed_fulfillment_type !== cart.fulfillmentType)) {
      return 'This item is unavailable for your current order.';
    }
    if (configError || reviewMessage || staleSelection) return configError || reviewMessage || staleSelection;
    if (bundleEnabled && (!bundleEligible || !(SIDE_POP_SIDES as readonly string[]).includes(bundleSide) || !(SIDE_POP_DRINKS as readonly string[]).includes(bundleDrink))) return 'Review your side and pop choices';
    const baseError = validationMessage(groups, selections);
    if (baseError) return baseError;

    if (wingBuilder) {
      if (!wingTypeGroup || !optionById(wingTypeGroup, selections[wingTypeGroup.id]?.[0])) {
        return "Choose your wing type";
      }
      for (const group of flavourGroups) {
        const option = optionById(group, selections[group.id]?.[0]);
        if (!option?.linked_flavour_id) return `Choose ${group.display_label || group.name}`;
      }
    }

    if (lunchBuilder) {
      if (!selectedChild) return "Choose a lunch item";
      if (!selectedChild.is_available || selectedChild.stock_status === 'UNAVAILABLE' || (selectedChild.allowed_fulfillment_type !== 'BOTH' && selectedChild.allowed_fulfillment_type !== cart.fulfillmentType)) return 'This lunch item is unavailable for your current order.';
      const childError = validationMessage(childAddonGroups, childSelections);
      if (childError) return childError;
    }

    if (buildable.requires_special_instructions && !notes.trim()) {
      return "Add special instructions";
    }

    return null;
  };

  const error = submitted ? validate() : null;

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === "SINGLE") {
        return { ...prev, [group.id]: current.includes(optionId) && !group.is_required && group.min_select === 0 ? [] : [optionId] };
      }
      const selected = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      if (selected.length > maximumSelections(group)) return prev;
      return { ...prev, [group.id]: selected };
    });
  };

  const toggleChildOption = (group: ModifierGroup, optionId: string) => {
    setChildSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_mode === "SINGLE") {
        return { ...prev, [group.id]: [optionId] };
      }
      const selected = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      const max = group.max_select ?? selected.length;
      return { ...prev, [group.id]: selected.slice(0, max) };
    });
  };

  const toggleRemoved = (ingredientId: string, child = false) => {
    const setter = child ? setChildRemovedIds : setRemovedIds;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  };

  const handleAdd = () => {
    const invalid = validate();
    if (invalid) {
      setSubmitted(true);
      return;
    }

    const removed = selectedRemovedIngredients(buildable, removedIds);
    const modifierSelections = selectedModifierSelections(groups, selections, {
      excludeFlavours: wingBuilder,
    });
    let builderPayload: CartBuilderPayload | undefined;
    let specialInstructions = notes.trim();

    if (wingBuilder) {
      const wingOption = optionById(wingTypeGroup!, selections[wingTypeGroup!.id]?.[0]);
      const sideGroups = groupsByContext(groups, "side");
      const drinkGroups = groupsByContext(groups, "drink");
      const savedPayload = editItem?.builder_payload;
      const priorWings = editItem?.menu_item_id === buildable.id &&
        (savedPayload?.builder_type === 'WINGS' || savedPayload?.builder_type === 'WING_COMBO') ? savedPayload : null;
      builderPayload = {
        ...priorWings,
        builder_type: buildable.builder_type === "WING_COMBO" ? "WING_COMBO" : "WINGS",
        wing_type: resolveWingType(wingOption),
        preparation: resolvePreparation(wingOption),
        weight_lb: selectedVariant?.weight_lb ?? parseWeightFromName(buildable.name),
        flavour_slots: flavourGroups.map((group, index) => {
          const option = optionById(group, selections[group.id]?.[0])!;
          return {
            slot_no: index + 1,
            wing_flavour_id: option.linked_flavour_id!,
            flavour_name: option.name,
            placement: priorWings?.flavour_slots.find(slot => slot.slot_no === index + 1)?.placement ?? "ON_WINGS",
          };
        }),
        side_selections:
          buildable.builder_type === "WING_COMBO"
            ? sideGroups.flatMap((group) => selections[group.id] ?? [])
            : undefined,
        drink_selections:
          buildable.builder_type === "WING_COMBO"
            ? drinkGroups.flatMap((group) => selections[group.id] ?? [])
            : undefined,
      } satisfies WingBuilderPayload;
    } else if (lunchBuilder && selectedChild) {
      const childRemoved = selectedRemovedIngredients(selectedChild, childRemovedIds);
      const childAddons = selectedModifierSelections(childAddonGroups, childSelections).map(
        (selection) => ({
          modifier_option_id: selection.modifier_option_id!,
          name: selection.option_name,
          price_delta_cents: selection.price_delta_cents,
        }),
      );
      builderPayload = {
        builder_type: "LUNCH_SPECIAL",
        child_menu_item_id: selectedChild.id,
        child_name: selectedChild.name,
        child_slug: selectedChild.slug,
        removed_ingredients: childRemoved,
        child_addons: childAddons,
      } satisfies LunchSpecialPayload;
      specialInstructions = addSpecialInstructions(
        notes,
        selectedChild,
        childRemoved,
        childAddons,
      );
    } else {
      builderPayload = {
        builder_type: "ITEM_CUSTOMIZATION",
        removed_ingredients: removed,
        ...(bundleEligible && bundleEnabled ? { side_pop_bundle: { price_cents: SIDE_POP_BUNDLE_PRICE_CENTS, side_label: bundleSide, pop_label: bundleDrink } } : {}),
      } satisfies ItemCustomizationPayload;
    }

    const nextItem: Omit<CartItem, 'key'> = {
      menu_item_id: buildable.id,
      menu_item_slug: buildable.slug,
      name: buildable.name,
      image_url: buildable.image_url,
      base_price_cents: buildable.base_price_cents,
      quantity,
      modifier_selections: modifierSelections,
      removed_ingredients: removed,
      special_instructions: specialInstructions,
      builder_payload: builderPayload,
    };
    if (editItem) cart.replaceItem(editItem.key, nextItem);
    else cart.addItem(nextItem);
    onClose();
  };

  return (
    <MobileBuilderShell visible={visible} title={item.name} description={buildable.description} onClose={onClose} compactFooter
      quantity={quantity} onDecrease={() => setQuantity(value => Math.max(1, value - 1))}
      onIncrease={() => setQuantity(value => value + 1)} totalCents={unitTotal * quantity}
      submitLabel={editItem ? 'Update Cart' : 'Add to Cart'} submitDisabled={unavailable} onSubmit={handleAdd}>
      <StepCard title={item.name} subtitle={buildable.description ?? undefined}><Text style={styles.basePrice}>{formatPrice(buildable.base_price_cents)}</Text></StepCard>
      {unavailable ? <StepCard title="Currently unavailable" subtitle="This item is unavailable for your current order."><View /></StepCard> : null}
      {configError || reviewMessage || staleSelection ? <StepCard title="Review this item" invalid subtitle={configError || reviewMessage || staleSelection || undefined}>
        {reviewMessage || staleSelection ? <TouchableOpacity accessibilityRole="button" onPress={reviewChoices}><Text style={styles.reviewText}>Review current choices</Text></TouchableOpacity> : null}
      </StepCard> : null}
      {error ? <StepCard title="Check your choices" invalid inlineError={error}><View /></StepCard> : null}
          {variants.length > 0 ? (
            <BuilderSection title="Size">
              <View style={styles.wrapRow}>
                {variants.map((variant) => {
                  const active = variant.menu_item_id === buildable.id;
                  return (
                    <TouchableOpacity
                      key={variant.menu_item_id}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setVariantId(variant.menu_item_id)}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>
                        {variant.name}
                      </Text>
                      <Text style={[styles.pillSubtext, active && styles.pillSubtextActive]}>
                        {formatPrice(variant.base_price_cents)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </BuilderSection>
          ) : null}

          {lunchBuilder ? (
            <BuilderSection title="Lunch item">
              <View style={styles.wrapRow}>
                {childItems.map((child) => {
                  const active = selectedChild?.id === child.id;
                  return (
                    <TouchableOpacity
                      key={child.id}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setChildId(child.id)}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>
                        {child.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </BuilderSection>
          ) : null}

          {groups.filter(group => group.context_key === 'size' && (group.options.length > 0 || group.is_required || group.min_select > 0)).map((group) => (
            <ModifierGroupPicker
              key={group.id}
              group={group}
              selections={selections[group.id] ?? []}
              onToggle={(optionId) => toggleOption(group, optionId)}
            />
          ))}

          {!lunchBuilder && buildable.removable_ingredients.length > 0 ? (
            <BuilderSection title="Included ingredients">
              <View style={styles.wrapRow}>
                {buildable.removable_ingredients.map((ingredient) => {
                  const active = !removedIds.has(ingredient.id);
                  return (
                    <TouchableOpacity
                      key={ingredient.id}
                      accessibilityRole="checkbox" accessibilityState={{ checked: active }} style={[styles.pill, active && styles.pillActive]}
                      onPress={() => toggleRemoved(ingredient.id)}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          active && styles.pillTextActive,
                        ]}
                      >
                        {active ? '\u2713 ' : '\u2212 '}{ingredient.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </BuilderSection>
          ) : null}

          {lunchBuilder && selectedChild ? (
            <>
              {selectedChild.removable_ingredients.length > 0 ? (
                <BuilderSection title="Included in your lunch item">
                  <View style={styles.wrapRow}>
                    {selectedChild.removable_ingredients.map((ingredient) => {
                      const active = !childRemovedIds.has(ingredient.id);
                      return (
                        <TouchableOpacity
                          key={ingredient.id}
                          accessibilityRole="checkbox" accessibilityState={{ checked: active }}
                          style={[styles.pill, active && styles.pillActive]}
                          onPress={() => toggleRemoved(ingredient.id, true)}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              active && styles.pillTextActive,
                            ]}
                          >
                            {active ? '\u2713 ' : '\u2212 '}{ingredient.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </BuilderSection>
              ) : null}

              {childAddonGroups.map((group) => (
                <ModifierGroupPicker
                  key={group.id}
                  group={group}
                  selections={childSelections[group.id] ?? []}
                  onToggle={(optionId) => toggleChildOption(group, optionId)}
                />
              ))}
            </>
          ) : null}

          {groups.filter(group => group.context_key !== 'size' && (group.options.length > 0 || group.is_required || group.min_select > 0)).map((group) => (
            <ModifierGroupPicker
              key={group.id}
              group={group}
              selections={selections[group.id] ?? []}
              onToggle={(optionId) => toggleOption(group, optionId)}
            />
          ))}
      {bundleEligible ? <StepCard title="Side + pop upgrade" subtitle={`Add a small side and a pop for $${(SIDE_POP_BUNDLE_PRICE_CENTS / 100).toFixed(2)}`}>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: bundleEnabled }} onPress={() => setBundleEnabled(value => !value)} style={[styles.pill, bundleEnabled && styles.pillActive]}>
          <Text style={[styles.pillText, bundleEnabled && styles.pillTextActive]}>{bundleEnabled ? '\u2713 ' : ''}Add side + pop</Text>
        </TouchableOpacity>
        {bundleEnabled ? <>
          <ChoicePills values={SIDE_POP_SIDES} selected={bundleSide} onSelect={setBundleSide} />
          <ChoicePills values={SIDE_POP_DRINKS} selected={bundleDrink} onSelect={setBundleDrink} />
        </> : null}
      </StepCard> : null}
      <StepCard title="Special instructions" subtitle={buildable.requires_special_instructions ? 'Required' : 'Optional'}>
        <NotesInput value={notes} onChange={setNotes} placeholder="Special instructions" />
      </StepCard>
    </MobileBuilderShell>
  );
}

function ChoicePills({ values, selected, onSelect }: { values: readonly string[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.wrapRow}>{values.map(value => <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ selected: value === selected }} onPress={() => onSelect(value)} style={[styles.pill, value === selected && styles.pillActive]}><Text style={[styles.pillText, value === selected && styles.pillTextActive]}>{value}</Text></TouchableOpacity>)}</View>;
}

function BuilderSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <StepCard title={title} subtitle={title.startsWith("Included") ? "Checked ingredients are included. Uncheck to remove at no extra charge." : undefined}>{children}</StepCard>
  );
}

function ModifierGroupPicker({
  group,
  selections,
  onToggle,
}: {
  group: ModifierGroup;
  selections: string[];
  onToggle: (optionId: string) => void;
}) {
  return (
    <BuilderSection title={group.display_label || group.name}>
      <View style={styles.wrapRow}>
        {sortedOptions(group.options).map((option) => {
          const active = selections.includes(option.id);
          return (
            <TouchableOpacity
              key={option.id}
              accessibilityRole={group.selection_mode === "SINGLE" ? "radio" : "checkbox"}
              accessibilityState={{ checked: active, selected: active }}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => onToggle(option.id)}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {active ? '\u2713 ' : ''}{option.name}
              </Text>
              {option.price_delta_cents > 0 ? (
                <Text style={[styles.pillSubtext, active && styles.pillSubtextActive]}>
                  +{formatPrice(option.price_delta_cents)}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </BuilderSection>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 46, maxWidth: '100%', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: P.card, borderWidth: 1.5, borderColor: P.border, justifyContent: 'center' },
  pillActive: { backgroundColor: P.peach, borderColor: P.red },
  pillText: { color: P.text, fontSize: 14, fontWeight: '600' },
  pillTextActive: { color: P.red, fontWeight: '700' },
  pillSubtext: { color: P.muted, fontSize: 12, fontWeight: '700', marginTop: 3 },
  pillSubtextActive: { color: P.red },
  basePrice: { color: P.red, fontSize: 24, fontWeight: '900' },
  reviewText: { color: P.red, fontSize: 14, fontWeight: '700', paddingVertical: 8 },
});
