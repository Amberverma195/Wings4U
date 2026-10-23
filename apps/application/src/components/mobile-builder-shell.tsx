import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { apiJson } from '../lib/api';
import { useCart } from '../context/cart';
import { DEFAULT_LOCATION_ID } from '../lib/env';
import type { MenuItem, WingFlavour } from '../lib/types';
import {
  EXTRA_FLAVOUR_PRICE_CENTS,
  ExtraFlavourGroup,
  FlavourGroup,
  groupFlavoursByHeat,
  groupFlavoursForExtraPicker,
  isFlavourWithoutSauce,
  methodRequiresSideFlavourPick,
  resolveSaucingPlacements,
  resolveInitialHeatTab,
  getSaucingOptions,
  formatCents,
} from '../lib/wing-builder-logic';

/* =========================================================================
   PALETTE  (Wings4U warm restaurant palette)
   ========================================================================= */
export const P = {
  charcoal:   '#251E1B',
  cream:      '#FFF9F5',
  card:       '#FFFFFF',
  red:        '#E53C3C',
  peach:      '#FFF0EA',
  peachBorder:'#F5C9B8',
  gold:       '#F5A623',
  goldLight:  '#FEF3E2',
  text:       '#1E1410',
  muted:      '#7A6358',
  border:     '#EDE5DF',
  disabled:   '#D4C8C3',
  disabledText:'#B0A29A',
};

/* =========================================================================
   MOBILE BUILDER SHELL
   ========================================================================= */
type BuilderShellProps = {
  visible: boolean;
  title: string;
  description?: string | null;
  onClose: () => void;
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  quantityDisabled?: boolean;
  totalCents: number;
  submitLabel: string;
  submitDisabled?: boolean;
  compactFooter?: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
};

export function MobileBuilderShell({
  visible,
  title,
  description,
  onClose,
  quantity,
  onDecrease,
  onIncrease,
  quantityDisabled,
  totalCents,
  submitLabel,
  submitDisabled,
  compactFooter = false,
  onSubmit,
  children,
}: BuilderShellProps) {
  const insets = useSafeAreaInsets();
  const decreaseDisabled = quantityDisabled || quantity <= 1;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[sh.container, { paddingTop: insets.top > 0 ? insets.top : 12 }]}>
        {/* Dark Header */}
        <View style={sh.header}>
          <View style={sh.headerText}>
            <Text style={sh.headerTitle} numberOfLines={2}>{title}</Text>
            {description ? (
              <Text style={sh.headerDesc} numberOfLines={2}>{description}</Text>
            ) : null}
          </View>
          <TouchableOpacity style={sh.closeBtn} onPress={onClose} accessibilityLabel="Close builder" accessibilityRole="button">
            <X size={20} color="#FFF9F5" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {/* Scrollable content */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.bottom + 88}
        >
          <ScrollView
            style={sh.scroll}
            contentContainerStyle={[sh.content, { paddingBottom: 24 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {/* Pinned footer */}
          <View style={[sh.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={sh.qtyRow}>
              <TouchableOpacity
                style={[sh.qtyBtn, decreaseDisabled && sh.qtyBtnDisabled]}
                onPress={onDecrease}
                disabled={Boolean(decreaseDisabled)}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                accessibilityState={{ disabled: Boolean(decreaseDisabled) }}
              >
                <Text style={[sh.qtyBtnText, decreaseDisabled && sh.qtyBtnTextDisabled]}>−</Text>
              </TouchableOpacity>
              <Text style={sh.qtyNum}>{quantity}</Text>
              <TouchableOpacity
                style={[sh.qtyBtn, quantityDisabled && sh.qtyBtnDisabled]}
                onPress={onIncrease}
                disabled={Boolean(quantityDisabled)}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                accessibilityState={{ disabled: Boolean(quantityDisabled) }}
              >
                <Text style={[sh.qtyBtnText, quantityDisabled && sh.qtyBtnTextDisabled]}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[sh.addBtn, submitDisabled && sh.addBtnDisabled]}
              onPress={onSubmit}
              disabled={Boolean(submitDisabled)}
              activeOpacity={submitDisabled ? 1 : 0.82}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(submitDisabled) }}
              accessibilityLabel={`${submitLabel}, ${formatCents(totalCents)}`}
            >
              <Text style={[sh.addBtnText, compactFooter && { fontSize: 14 }]}>{submitLabel}</Text>
              <View style={sh.addBtnSep} />
              <Text style={[sh.addBtnPrice, compactFooter && { fontSize: 14, paddingHorizontal: 10 }]}>{formatCents(totalCents)}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const sh = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: P.cream,
  },
  header: {
    backgroundColor: P.charcoal,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: { flex: 1 },
  headerTitle: {
    color: '#FFF9F5',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  headerDesc: {
    color: 'rgba(255,249,245,0.65)',
    fontSize: 13,
    marginTop: 3,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  footer: {
    backgroundColor: P.card,
    borderTopWidth: 1,
    borderTopColor: P.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: P.peach,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.peachBorder,
  },
  qtyBtn: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: P.charcoal,
  },
  qtyBtnTextDisabled: { color: P.disabledText },
  qtyNum: {
    fontSize: 17,
    fontWeight: '800',
    color: P.charcoal,
    minWidth: 28,
    textAlign: 'center',
  },
  addBtn: {
    flex: 1,
    height: 50,
    backgroundColor: P.red,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    overflow: 'hidden',
  },
  addBtnDisabled: { opacity: 0.55 },
  addBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
  },
  addBtnSep: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  addBtnPrice: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
});

/* =========================================================================
   STEP CARD
   ========================================================================= */
type StepCardProps = {
  title: string;
  subtitle?: string;
  invalid?: boolean;
  inlineError?: string | null;
  children: React.ReactNode;
};

export function StepCard({ title, subtitle, invalid, inlineError, children }: StepCardProps) {
  return (
    <View style={[sc.card, invalid && sc.cardInvalid]}>
      <View style={sc.head}>
        <Text style={sc.title}>{title}</Text>
        {subtitle ? <Text style={sc.subtitle}>{subtitle}</Text> : null}
      </View>
      {inlineError ? (
        <View style={sc.errWrap} accessibilityRole="alert">
          <Text style={sc.errText}>{inlineError}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    backgroundColor: P.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: P.border,
    gap: 12,
  },
  cardInvalid: {
    borderColor: P.red,
    borderWidth: 1.5,
  },
  head: { gap: 3 },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: P.text,
  },
  subtitle: {
    fontSize: 13,
    color: P.muted,
    lineHeight: 18,
  },
  errWrap: {
    backgroundColor: 'rgba(229,60,60,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errText: {
    fontSize: 12,
    fontWeight: '600',
    color: P.red,
  },
});

/* =========================================================================
   OPTION PILLS
   ========================================================================= */
type OptionPill = { value: string; label: string; priceNote?: string };

type OptionPillsProps = {
  options: OptionPill[];
  value?: string | null;
  values?: string[];
  multi?: boolean;
  onChange?: (value: string) => void;
  onToggle?: (value: string) => void;
  disabled?: boolean;
};

export function OptionPills({
  options,
  value = null,
  values,
  multi = false,
  onChange,
  onToggle,
  disabled,
}: OptionPillsProps) {
  return (
    <View style={op.row}>
      {options.map((opt) => {
        const active = multi ? Boolean(values?.includes(opt.value)) : opt.value === value;
        const handlePress = () => {
          if (disabled) return;
          if (multi) {
            if (onToggle) onToggle(opt.value);
            else if (onChange) onChange(opt.value);
          } else {
            onChange?.(opt.value);
          }
        };

        return (
          <TouchableOpacity
            key={opt.value}
            style={[op.pill, active && op.pillActive, disabled && op.pillDisabled]}
            onPress={handlePress}
            activeOpacity={disabled ? 1 : 0.75}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: active, disabled: Boolean(disabled) }}
          >
            <Text style={[op.label, active && op.labelActive, disabled && op.labelDisabled]}>
              {opt.label}
            </Text>
            {opt.priceNote ? (
              <Text style={[op.price, active && op.priceActive]}>{opt.priceNote}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const op = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: P.border,
    backgroundColor: P.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillActive: {
    backgroundColor: P.peach,
    borderColor: P.red,
  },
  pillDisabled: {
    backgroundColor: '#F5F0ED',
    borderColor: P.border,
    opacity: 0.55,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: P.text,
  },
  labelActive: {
    color: P.red,
    fontWeight: '700',
  },
  labelDisabled: {
    color: P.disabledText,
  },
  price: {
    fontSize: 12,
    fontWeight: '600',
    color: P.muted,
  },
  priceActive: {
    color: P.red,
  },
});

/* =========================================================================
   FLAVOUR PICKER (heat tabs + flavour pills)
   ========================================================================= */
type FlavourPickerProps = {
  flavours: WingFlavour[];
  selectedFlavourId: string;
  onSelect: (flavour: WingFlavour) => void;
  disabled?: boolean;
};

export function FlavourPicker({ flavours, selectedFlavourId, onSelect, disabled }: FlavourPickerProps) {
  const grouped = useMemo(() => groupFlavoursByHeat(flavours), [flavours]);
  const defaultTab = useMemo(
    () => resolveInitialHeatTab(flavours, grouped, selectedFlavourId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped],
  );
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Follow the selected flavour's tab when selection changes externally
  useEffect(() => {
    if (!selectedFlavourId) return;
    const fl = flavours.find((f) => f.id === selectedFlavourId);
    if (fl) {
      const level = fl.is_plain ? 'PLAIN' : fl.heat_level;
      setActiveTab(level);
    }
  }, [selectedFlavourId, flavours]);

  const activeGroup = grouped.find((g) => g.level === activeTab) ?? grouped[0];

  return (
    <View style={fp.root}>
      {/* Heat level tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={fp.tabsRow}
      >
        {grouped.map((group) => {
          const active = group.level === activeTab;
          return (
            <TouchableOpacity
              key={group.level}
              style={[fp.tab, active && fp.tabActive]}
              onPress={() => !disabled && setActiveTab(group.level)}
              activeOpacity={disabled ? 1 : 0.75}
            >
              <Text style={[fp.tabLabel, active && fp.tabLabelActive]}>
                {group.level.replace(/_/g, ' ')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Flavour options */}
      <View style={fp.pillsRow}>
        {activeGroup?.items.map((flavour) => {
          const active = flavour.id === selectedFlavourId;
          return (
            <TouchableOpacity
              key={flavour.id}
              style={[fp.pill, active && fp.pillActive, disabled && fp.pillDisabled]}
              onPress={() => !disabled && onSelect(flavour)}
              activeOpacity={disabled ? 1 : 0.75}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
            >
              <Text style={[fp.pillLabel, active && fp.pillLabelActive]}>
                {flavour.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const fp = StyleSheet.create({
  root: { gap: 10 },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3EDE9',
    borderWidth: 1,
    borderColor: P.border,
  },
  tabActive: {
    backgroundColor: P.charcoal,
    borderColor: P.charcoal,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: P.muted,
    textTransform: 'capitalize',
  },
  tabLabelActive: {
    color: '#FFF9F5',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: P.border,
    backgroundColor: P.card,
  },
  pillActive: {
    backgroundColor: P.peach,
    borderColor: P.red,
  },
  pillDisabled: { opacity: 0.45 },
  pillLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: P.text,
  },
  pillLabelActive: {
    color: P.red,
    fontWeight: '700',
  },
});

/* =========================================================================
   EXTRA FLAVOUR PICKER (paid, no plain)
   ========================================================================= */
type ExtraFlavourPickerProps = {
  flavours: WingFlavour[];
  selectedFlavourId: string;
  onSelect: (flavour: WingFlavour) => void;
};

export function ExtraFlavourPicker({ flavours, selectedFlavourId, onSelect }: ExtraFlavourPickerProps) {
  const grouped = useMemo(() => groupFlavoursForExtraPicker(flavours), [flavours]);
  const [activeTab, setActiveTab] = useState(grouped[0]?.label ?? 'Mild');

  useEffect(() => {
    if (!selectedFlavourId) return;
    for (const group of grouped) {
      if (group.items.some((f) => f.id === selectedFlavourId)) {
        setActiveTab(group.label);
        return;
      }
    }
  }, [selectedFlavourId, grouped]);

  const activeGroup = grouped.find((g) => g.label === activeTab) ?? grouped[0];

  return (
    <View style={fp.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fp.tabsRow}>
        {grouped.map((group) => {
          const active = group.label === activeTab;
          return (
            <TouchableOpacity
              key={group.label}
              style={[fp.tab, active && fp.tabActive]}
              onPress={() => setActiveTab(group.label)}
              activeOpacity={0.75}
            >
              <Text style={[fp.tabLabel, active && fp.tabLabelActive]}>{group.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={fp.pillsRow}>
        {activeGroup?.items.map((flavour) => {
          const active = flavour.id === selectedFlavourId;
          return (
            <TouchableOpacity
              key={flavour.id}
              style={[fp.pill, active && fp.pillActive]}
              onPress={() => onSelect(flavour)}
              activeOpacity={0.75}
            >
              <Text style={[fp.pillLabel, active && fp.pillLabelActive]}>{flavour.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* =========================================================================
   SAUCING METHOD PICKER
   ========================================================================= */
type SaucingMethodPickerProps = {
  effectiveSaucedCount: number;
  slotCount: number;
  value: string | null;
  onChange: (value: string) => void;
  partyFiveSpecial?: boolean;
  threeFlavourTellUsHow?: boolean;
  sideFlavourOptions?: Array<{ slotNo: number; label: string }>;
  sideFlavourSlot?: number | null;
  onSideFlavourSlotChange?: (slotNo: number) => void;
};

export function SaucingMethodPicker({
  effectiveSaucedCount,
  slotCount,
  value,
  onChange,
  partyFiveSpecial = false,
  threeFlavourTellUsHow = false,
  sideFlavourOptions = [],
  sideFlavourSlot = null,
  onSideFlavourSlotChange,
}: SaucingMethodPickerProps) {
  const options = getSaucingOptions(effectiveSaucedCount, slotCount, partyFiveSpecial, threeFlavourTellUsHow);
  const showSideQuestion = methodRequiresSideFlavourPick(effectiveSaucedCount, value);
  const sideQuestionLabel =
    effectiveSaucedCount === 2
      ? 'Which flavour goes on the side?'
      : 'Which flavour do you want on the side?';

  return (
    <View style={{ gap: 12 }}>
      <OptionPills
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        value={value}
        onChange={onChange}
      />
      {showSideQuestion && sideFlavourOptions.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={sc.subtitle}>{sideQuestionLabel}</Text>
          <OptionPills
            options={sideFlavourOptions.map((o) => ({ value: String(o.slotNo), label: o.label }))}
            value={sideFlavourSlot !== null ? String(sideFlavourSlot) : null}
            onChange={(v) => onSideFlavourSlotChange?.(Number(v))}
          />
        </View>
      ) : null}
    </View>
  );
}

/* =========================================================================
   useWingFlavours hook (mobile version — uses /api/v1/menu/wing-flavours)
   ========================================================================= */
export function useWingFlavours(_fallbackItem?: MenuItem | null) {
  const { locationId } = useCart();
  const effectiveLocationId = locationId || DEFAULT_LOCATION_ID;
  const [flavours, setFlavours] = useState<WingFlavour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestIdRef.current += 1;
    };
  }, []);

  const loadFlavours = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const env = await apiJson<WingFlavour[]>(
        `/api/v1/menu/wing-flavours?location_id=${effectiveLocationId}`,
        { locationId: effectiveLocationId },
      );
      if (!isMountedRef.current || activeRequestIdRef.current !== requestId) {
        return;
      }
      setFlavours(env.data ?? []);
      setError(null);
    } catch (cause) {
      if (!isMountedRef.current || activeRequestIdRef.current !== requestId) {
        return;
      }
      setFlavours([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load wing flavours');
    } finally {
      if (isMountedRef.current && activeRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [effectiveLocationId]);

  useEffect(() => {
    setFlavours([]);
    void loadFlavours();
  }, [loadFlavours]);

  return {
    flavours,
    loading,
    error,
    retry: loadFlavours,
  };
}

/* =========================================================================
   NOTES INPUT (shared)
   ========================================================================= */
type NotesInputProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function NotesInput({ value, onChange, placeholder }: NotesInputProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? 'Anything we should know?'}
      placeholderTextColor={P.disabledText}
      multiline
      numberOfLines={3}
      style={ni.input}
      textAlignVertical="top"
    />
  );
}

const ni = StyleSheet.create({
  input: {
    backgroundColor: '#F8F3EF',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: P.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: P.text,
    minHeight: 72,
  },
});

export const BUILDER_VALIDATION_MESSAGE = 'Please fill all required fields';
