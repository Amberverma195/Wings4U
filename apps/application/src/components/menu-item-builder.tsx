import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { useCart } from "../context/cart";
import type {
  BuilderMenuOption,
  CartBuilderPayload,
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

function initialSelections(groups: ModifierGroup[]): SelectionMap {
  const next: SelectionMap = {};
  for (const group of groups) {
    const defaults = group.options.filter((option) => option.is_default);
    const requiredCount = Math.max(group.min_select, group.is_required ? 1 : 0);
    const max = group.max_select ?? group.options.length;
    const picked = defaults.slice(0, max).map((option) => option.id);
    for (const option of group.options) {
      if (picked.length >= requiredCount || picked.length >= max) break;
      if (!picked.includes(option.id)) picked.push(option.id);
    }
    next[group.id] = group.selection_mode === "SINGLE" ? picked.slice(0, 1) : picked;
  }
  return next;
}

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

function modifierTotal(groups: ModifierGroup[], selections: SelectionMap): number {
  let total = 0;
  for (const group of groups) {
    for (const optionId of selections[group.id] ?? []) {
      total += optionById(group, optionId)?.price_delta_cents ?? 0;
    }
  }
  return total;
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

function validationMessage(groups: ModifierGroup[], selections: SelectionMap): string | null {
  for (const group of groups) {
    const count = selections[group.id]?.length ?? 0;
    if (count < group.min_select) {
      return `Choose ${group.display_label || group.name}`;
    }
    if (group.max_select !== null && count > group.max_select) {
      return `Choose fewer options for ${group.display_label || group.name}`;
    }
  }
  return null;
}

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
  return categories.find((category) => category.slug === categorySlug)?.items ?? [];
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

export function MenuItemBuilder({ item, visible, categories, onClose }: Props) {
  const cart = useCart();
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

  const childItems = useMemo(() => lunchChildren(categories, item), [categories, item]);
  const selectedChild = useMemo(
    () => childItems.find((child) => child.id === childId) ?? childItems[0] ?? null,
    [childId, childItems],
  );

  useEffect(() => {
    if (!visible || !item) return;
    const nextVariants = variantOptions(item);
    setVariantId(nextVariants[0]?.menu_item_id ?? null);
    setQuantity(1);
    setNotes("");
    setSubmitted(false);
    setRemovedIds(new Set());
    setChildRemovedIds(new Set());
    const children = lunchChildren(categories, item);
    setChildId(children[0]?.id ?? null);
  }, [categories, item, visible]);

  useEffect(() => {
    if (!buildable) return;
    setSelections(initialSelections(sortedGroups(buildable.modifier_groups)));
  }, [buildable]);

  useEffect(() => {
    if (!selectedChild) {
      setChildSelections({});
      return;
    }
    setChildSelections(initialSelections(sortedGroups(selectedChild.modifier_groups)));
  }, [selectedChild]);

  if (!item || !buildable) return null;

  const groups = sortedGroups(buildable.modifier_groups);
  const wingBuilder = isWingBuilder(buildable);
  const lunchBuilder = isLunchChildBuilder(item);
  const flavourGroups = groups.filter(isFlavourGroup);
  const wingTypeGroup = groups.find(isWingTypeGroup) ?? null;
  const childAddonGroups = sortedGroups(
    (selectedChild?.modifier_groups ?? []).filter(
      (group) => group.context_key === "addon" || group.name.toLowerCase().includes("extras"),
    ),
  );

  const selectedWingOption = wingTypeGroup
    ? optionById(wingTypeGroup, selections[wingTypeGroup.id]?.[0])
    : null;
  const unitTotal =
    buildable.base_price_cents +
    modifierTotal(groups, selections) +
    (wingBuilder && resolveWingType(selectedWingOption) === "BONELESS"
      ? BONELESS_WINGS_UPCHARGE_CENTS
      : 0) +
    (lunchBuilder && selectedChild
      ? modifierTotal(childAddonGroups, childSelections)
      : 0);

  const validate = (): string | null => {
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
        return { ...prev, [group.id]: [optionId] };
      }
      const selected = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      const max = group.max_select ?? selected.length;
      return { ...prev, [group.id]: selected.slice(0, max) };
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
      builderPayload = {
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
            placement: "ON_WINGS",
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
    } else if (removed.length > 0) {
      builderPayload = {
        builder_type: "ITEM_CUSTOMIZATION",
        removed_ingredients: removed,
      } satisfies ItemCustomizationPayload;
    }

    cart.addItem({
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
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={2}>
              {item.name}
            </Text>
            {buildable.description ? (
              <Text style={styles.description} numberOfLines={2}>
                {buildable.description}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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

          {lunchBuilder && selectedChild ? (
            <BuilderSection title="Lunch item">
              <View style={styles.wrapRow}>
                {childItems.map((child) => {
                  const active = selectedChild.id === child.id;
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

          {groups.map((group) => (
            <ModifierGroupPicker
              key={group.id}
              group={group}
              selections={selections[group.id] ?? []}
              onToggle={(optionId) => toggleOption(group, optionId)}
            />
          ))}

          {!lunchBuilder && buildable.removable_ingredients.length > 0 ? (
            <BuilderSection title="Remove">
              <View style={styles.wrapRow}>
                {buildable.removable_ingredients.map((ingredient) => {
                  const active = removedIds.has(ingredient.id);
                  return (
                    <TouchableOpacity
                      key={ingredient.id}
                      style={[styles.pill, active && styles.removePillActive]}
                      onPress={() => toggleRemoved(ingredient.id)}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          active && styles.removePillTextActive,
                        ]}
                      >
                        {ingredient.name}
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
                <BuilderSection title="Remove from lunch item">
                  <View style={styles.wrapRow}>
                    {selectedChild.removable_ingredients.map((ingredient) => {
                      const active = childRemovedIds.has(ingredient.id);
                      return (
                        <TouchableOpacity
                          key={ingredient.id}
                          style={[styles.pill, active && styles.removePillActive]}
                          onPress={() => toggleRemoved(ingredient.id, true)}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              active && styles.removePillTextActive,
                            ]}
                          >
                            {ingredient.name}
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

          <BuilderSection title="Notes">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Special instructions"
              placeholderTextColor="#999"
              multiline
              style={styles.notesInput}
            />
          </BuilderSection>
        </ScrollView>

        <View style={styles.footer}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.footerRow}>
            <View style={styles.quantityControl}>
              <TouchableOpacity
                style={styles.qtyButton}
                onPress={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                <Text style={styles.qtyButtonText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.quantityText}>{quantity}</Text>
              <TouchableOpacity
                style={styles.qtyButton}
                onPress={() => setQuantity((value) => value + 1)}
              >
                <Text style={styles.qtyButtonText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
              <Text style={styles.addButtonText}>
                Add {formatPrice(unitTotal * quantity)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BuilderSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
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
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => onToggle(option.id)}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {option.name}
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
  container: {
    flex: 1,
    backgroundColor: "#FAFAFA",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 58,
    paddingBottom: 14,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EFEFEF",
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#1A1A1A",
  },
  description: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: "#666",
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F6F6",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    color: "#1A1A1A",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    minHeight: 44,
    maxWidth: "100%",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E9E9E9",
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: "#FF4D4D",
    borderColor: "#FF4D4D",
  },
  removePillActive: {
    backgroundColor: "rgba(255,77,77,0.08)",
    borderColor: "#FF4D4D",
  },
  pillText: {
    color: "#333",
    fontSize: 13,
    fontWeight: "800",
  },
  pillTextActive: {
    color: "#FFF",
  },
  removePillTextActive: {
    color: "#FF4D4D",
  },
  pillSubtext: {
    color: "#777",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  pillSubtextActive: {
    color: "#FFF",
  },
  notesInput: {
    minHeight: 92,
    borderRadius: 14,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E9E9E9",
    padding: 14,
    fontSize: 14,
    color: "#1A1A1A",
    textAlignVertical: "top",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#EFEFEF",
  },
  errorText: {
    marginBottom: 10,
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: "800",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  quantityControl: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 26,
    backgroundColor: "#F4F4F4",
    paddingHorizontal: 4,
  },
  qtyButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
  },
  qtyButtonText: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
    color: "#1A1A1A",
  },
  quantityText: {
    width: 34,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "900",
    color: "#1A1A1A",
  },
  addButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF4D4D",
  },
  addButtonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
