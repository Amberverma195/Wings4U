"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiJson } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { EXTRA_FLAVOUR_PRICE_CENTS } from "@/lib/cart-item-utils";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { cents } from "@/lib/format";
import type { WingFlavour } from "@/lib/types";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useModalDialog } from "@/lib/use-modal-dialog";

const HEAT_ORDER = ["PLAIN", "MILD", "MEDIUM", "HOT", "DRY_RUB"] as const;

type BuilderStepState = {
  id: string;
  label: string;
  status: "complete" | "active" | "pending";
};

type FlavourPickerProps = {
  flavours: WingFlavour[];
  selectedFlavourId: string;
  onSelect: (flavour: WingFlavour) => void;
  disabled?: boolean;
};

type SaucingMethodPickerProps = {
  effectiveSaucedCount: number;
  slotCount: number;
  value: string | null;
  onChange: (value: string) => void;
  /**
   * Party 75/100 wing packs (5 flavours): only All mixed / Split evenly / Tell us how.
   */
  partyFiveSpecial?: boolean;
  /**
   * Three-flavour wing builds should not offer "Two mixed + one on the side";
   * customers can choose a free-text instruction path instead.
   */
  threeFlavourTellUsHow?: boolean;
  /** Only the non-plain flavour slots that are eligible for "on the side". */
  sideFlavourOptions?: Array<{ slotNo: number; label: string }>;
  /** 1-based slot number for the flavour going on the side, or null. */
  sideFlavourSlot?: number | null;
  onSideFlavourSlotChange?: (slotNo: number) => void;
};

/**
 * Returns true when the chosen method requires the
 * "which flavour is on the side?" sub-question.
 */
export function methodRequiresSideFlavourPick(
  effectiveSaucedCount: number,
  method: string | null,
): boolean {
  if (!method) return false;
  if (effectiveSaucedCount === 2) return method === "SIDE";
  if (effectiveSaucedCount >= 3) return method === "TWO_MIXED_ONE_SIDE";
  return false;
}

export function defaultSaucingMethodForCount(
  effectiveSaucedCount: number,
  partyFiveSpecial?: boolean,
  slotCount = effectiveSaucedCount,
  threeFlavourTellUsHow = false,
): string | null {
  if (effectiveSaucedCount <= 0) return null;
  if (effectiveSaucedCount === 1) return "ON_WINGS";
  if (threeFlavourTellUsHow) return "SPLIT_EVENLY";
  if (partyFiveSpecial && slotCount === 5) return "ALL_MIXED";
  if (effectiveSaucedCount === 2) return "HALF_HALF";
  return "TWO_MIXED_ONE_SIDE";
}

/** No sauce to toss or split — hide saucing method when every slot is plain. */
export function isFlavourWithoutSauce(flavour: WingFlavour | undefined): boolean {
  if (!flavour) return false;
  if (flavour.is_plain) return true;
  return flavour.heat_level === "PLAIN";
}

export function areAllSelectedFlavoursPlain(
  flavourIds: string[],
  flavourMap: Map<string, WingFlavour>,
): boolean {
  if (flavourIds.length === 0) return false;
  if (flavourIds.some((id) => !id)) return false;
  return flavourIds.every((id) => isFlavourWithoutSauce(flavourMap.get(id)));
}

export function countEffectiveSaucedFlavours(
  flavourIds: string[],
  flavourMap: Map<string, WingFlavour>,
): number {
  return flavourIds.reduce((count, id) => {
    if (!id) return count;
    const flavour = flavourMap.get(id);
    return flavour && !isFlavourWithoutSauce(flavour) ? count + 1 : count;
  }, 0);
}

function getHeatLevel(flavour: WingFlavour) {
  return flavour.is_plain ? "PLAIN" : flavour.heat_level;
}

// Saucing method values follow PRD §5.2 / §10.2 vocabulary so the kitchen
// snapshot stays consistent across the order pipeline.
function getSaucingOptions(
  effectiveSaucedCount: number,
  slotCount: number,
  partyFiveSpecial?: boolean,
  threeFlavourTellUsHow = false,
) {
  if (effectiveSaucedCount <= 1) {
    return [
      { value: "ON_WINGS", label: "Sauce on wings" },
      { value: "ON_SIDE", label: "On the side" },
    ];
  }

  if (threeFlavourTellUsHow) {
    return [
      { value: "SPLIT_EVENLY", label: "Split evenly (1/3 + 1/3 + 1/3)" },
      { value: "ALL_MIXED", label: "All mixed together" },
      { value: "TELL_US_HOW", label: "Tell us how to do it" },
    ];
  }

  if (partyFiveSpecial && slotCount === 5 && effectiveSaucedCount >= 2) {
    return [
      { value: "ALL_MIXED", label: "All mixed together" },
      { value: "SPLIT_EVENLY", label: "Split evenly" },
      { value: "TELL_US_HOW", label: "Tell us how to do it" },
    ];
  }

  if (effectiveSaucedCount === 2) {
    return [
      { value: "HALF_HALF", label: "Half and half" },
      { value: "SIDE", label: "Sauce on the side" },
    ];
  }

  return [
    { value: "TWO_MIXED_ONE_SIDE", label: "Two mixed + one on the side" },
    { value: "SPLIT_EVENLY", label: "Split evenly (1/3 + 1/3 + 1/3)" },
    { value: "ALL_MIXED", label: "All mixed together" },
  ];
}

export function isSaucingMethodValidForCount(
  effectiveSaucedCount: number,
  method: string | null,
  partyFiveSpecial?: boolean,
  slotCount = effectiveSaucedCount,
  threeFlavourTellUsHow = false,
): boolean {
  if (!method) return false;
  return getSaucingOptions(
    effectiveSaucedCount,
    slotCount,
    partyFiveSpecial,
    threeFlavourTellUsHow,
  ).some(
    (option) => option.value === method,
  );
}

/**
 * Resolve per-slot sauce placement while treating plain / no-sauce picks as
 * neutral slots. Real sauce counts drive the method vocabulary; plain slots
 * always stay ON_WINGS.
 */
export function resolveSaucingPlacements(params: {
  flavourIds: string[];
  flavourMap: Map<string, WingFlavour>;
  saucingMethod: string | null;
  sideSlot: number | null;
}): Array<"ON_WINGS" | "ON_SIDE" | "MIXED"> {
  const { flavourIds, flavourMap, saucingMethod, sideSlot } = params;
  if (flavourIds.length <= 0) return [];

  const saucedSlotNumbers = flavourIds.flatMap((id, index) => {
    if (!id) return [];
    const flavour = flavourMap.get(id);
    return flavour && !isFlavourWithoutSauce(flavour) ? [index + 1] : [];
  });

  if (saucedSlotNumbers.length <= 0) {
    return Array.from({ length: flavourIds.length }, () => "ON_WINGS" as const);
  }

  const validSideSlot =
    sideSlot && saucedSlotNumbers.includes(sideSlot)
      ? sideSlot
      : saucedSlotNumbers[0] ?? null;

  return flavourIds.map((id, index) => {
    if (!id) return "ON_WINGS";

    const flavour = flavourMap.get(id);
    if (!flavour || isFlavourWithoutSauce(flavour)) {
      return "ON_WINGS";
    }

    const slotNo = index + 1;
    if (saucedSlotNumbers.length === 1) {
      return saucingMethod === "ON_SIDE" ? "ON_SIDE" : "ON_WINGS";
    }

    if (saucedSlotNumbers.length === 2) {
      if (saucingMethod === "MIXED") return "MIXED";
      if (saucingMethod === "SIDE") {
        return slotNo === validSideSlot ? "ON_SIDE" : "ON_WINGS";
      }
      return "ON_WINGS";
    }

    if (saucingMethod === "ALL_MIXED") return "MIXED";
    if (saucingMethod === "SPLIT_EVENLY") return "ON_WINGS";
    if (saucingMethod === "TELL_US_HOW") return "ON_WINGS";
    return slotNo === validSideSlot ? "ON_SIDE" : "MIXED";
  });
}

export function useWingFlavours() {
  const { locationId } = useCart();
  const effectiveLocationId = locationId || DEFAULT_LOCATION_ID;
  const [flavours, setFlavours] = useState<WingFlavour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFlavours() {
      setLoading(true);
      setError(null);
      try {
        const env = await apiJson<WingFlavour[]>(
          `/api/catalog/wing-flavours?location_id=${effectiveLocationId}`,
          { locationId: effectiveLocationId },
        );
        if (!cancelled) {
          setFlavours(env.data ?? []);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load wing flavours");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadFlavours();

    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId]);

  return { flavours, loading, error };
}

export function CompactStepProgress({ steps }: { steps: BuilderStepState[] }) {
  if (steps.length === 0) return null;
  const total = steps.length;
  const completedCount = steps.filter((s) => s.status === "complete").length;
  const active =
    steps.find((s) => s.status === "active") ?? steps[steps.length - 1];
  const activeIndex = steps.findIndex((s) => s.id === active.id);
  return (
    <div className="builder-step-progress" aria-label="Builder progress">
      <span className="builder-step-progress-count">
        Step {activeIndex + 1} of {total}
      </span>
      <span aria-hidden="true" className="builder-step-progress-sep">
        ·
      </span>
      <strong className="builder-step-progress-label">{active.label}</strong>
      <span className="builder-step-progress-meta">
        {completedCount}/{total} done
      </span>
    </div>
  );
}

/** Shown inside the step card that failed validation (not at the top of the scroll area). */
export const BUILDER_VALIDATION_MESSAGE = "Please fill all required fields";

/** Primary footer CTA: cart “edit line” vs new add — same quantity controls either way. */
export function builderSubmitLabel(isEditing: boolean): string {
  return isEditing ? "Save changes" : "Add to cart";
}

type BuilderShellProps = {
  title: string;
  description?: string | null;
  onClose: () => void;
  closeAriaLabel?: string;
  steps?: BuilderStepState[];
  /**
   * Whether to render the inline "Step n of m / x/y done" progress strip.
   * Hidden by default — customers don't need this scaffolding. Pass true
   * only on builders where progress feedback is genuinely useful.
   */
  showStepProgress?: boolean;
  // Footer
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  quantityDisabled?: boolean;
  totalCents: number;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  children: ReactNode;
};

/**
 * Single overlay shell used by every product builder/customizer.
 * Handles backdrop, body scroll lock, ESC to close, click-outside to close,
 * the panel header, the scrollable middle, and the pinned footer.
 *
 * To restyle the card background for every category, change `.builder-panel`
 * in `globals.css` — every overlay flows through this component.
 */
export function BuilderShell({
  title,
  description,
  onClose,
  closeAriaLabel = "Close",
  steps,
  showStepProgress = false,
  quantity,
  onDecrease,
  onIncrease,
  quantityDisabled,
  totalCents,
  submitLabel,
  submitDisabled,
  onSubmit,
  children,
}: BuilderShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useModalDialog({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
  });

  return (
    <div className="item-customization-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="builder-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="builder-panel-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="item-customization-close"
            onClick={onClose}
            aria-label={closeAriaLabel}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="builder-panel-body">
          {showStepProgress && steps && steps.length > 0 ? (
            <CompactStepProgress steps={steps} />
          ) : null}
          {children}
        </div>

        <BuilderStickyFooter
          quantity={quantity}
          onDecrease={onDecrease}
          onIncrease={onIncrease}
          quantityDisabled={quantityDisabled}
          totalCents={totalCents}
          submitLabel={submitLabel}
          disabled={submitDisabled}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}

export const StepContainer = forwardRef<HTMLElement, {
  title: string;
  subtitle?: string;
  invalid?: boolean;
  /** Renders below the header, inside this step card, when set. */
  inlineError?: string | null;
  children: ReactNode;
}>(({ title, subtitle, invalid = false, inlineError = null, children }, ref) => {
  return (
    <section
      ref={ref}
      className={`builder-step-card${invalid ? " builder-step-card-invalid" : ""}`}
    >
      <div className="builder-step-card-head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {inlineError ? (
        <div
          className="builder-step-inline-error"
          role="alert"
          aria-live="assertive"
        >
          {inlineError}
        </div>
      ) : null}
      {children}
    </section>
  );
});

StepContainer.displayName = "StepContainer";

export function BuilderStickyFooter({
  quantity,
  onDecrease,
  onIncrease,
  quantityDisabled,
  totalCents,
  submitLabel,
  disabled,
  onSubmit,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  quantityDisabled?: boolean;
  totalCents: number;
  submitLabel: string;
  disabled?: boolean;
  onSubmit: () => void;
}) {
  const decreaseDisabled = Boolean(quantityDisabled || quantity <= 1);

  return (
    <div className="builder-sticky-footer">
      <div className="builder-sticky-footer-qty">
        <button type="button" onClick={onDecrease} disabled={decreaseDisabled} aria-label="Decrease quantity">
          -
        </button>
        <span>{quantity}</span>
        <button type="button" onClick={onIncrease} disabled={quantityDisabled} aria-label="Increase quantity">
          +
        </button>
      </div>
      <button
        type="button"
        className={`builder-sticky-footer-submit${disabled ? " builder-sticky-footer-submit-pending" : ""}`}
        onClick={onSubmit}
        aria-disabled={disabled || undefined}
      >
        {submitLabel} · <span className="builder-submit-total">{cents(totalCents)}</span>
      </button>
    </div>
  );
}

export function FlavourPicker({
  flavours,
  selectedFlavourId,
  onSelect,
  disabled = false,
}: FlavourPickerProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, WingFlavour[]>();
    for (const flavour of flavours) {
      const level = getHeatLevel(flavour);
      if (!map.has(level)) {
        map.set(level, []);
      }
      map.get(level)!.push(flavour);
    }

    for (const entries of map.values()) {
      entries.sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
    }

    const ordered: Array<{ level: string; items: WingFlavour[] }> = HEAT_ORDER
      .map((level) => ({ level, items: map.get(level) ?? [] }))
      .filter((entry) => entry.items.length > 0);

    for (const [level, items] of map.entries()) {
      if (!ordered.some((entry) => entry.level === level)) {
        ordered.push({ level, items });
      }
    }

    return ordered;
  }, [flavours]);

  const selectedHeat = useMemo(() => {
    const selected = flavours.find((flavour) => flavour.id === selectedFlavourId);
    if (selected) return getHeatLevel(selected);
    // No flavour picked yet — start the customer on the first non-PLAIN tab
    // so the Plain group is never visually pre-selected (PRD §5: customer
    // must make an explicit flavour choice).
    const firstNonPlain = grouped.find((group) => group.level !== "PLAIN");
    return firstNonPlain?.level ?? grouped[0]?.level ?? "MILD";
  }, [flavours, grouped, selectedFlavourId]);

  const [activeHeat, setActiveHeat] = useState(selectedHeat);

  useEffect(() => {
    setActiveHeat(selectedHeat);
  }, [selectedHeat]);

  const baseId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = grouped.findIndex((group) => group.level === activeHeat);
  const currentActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeGroup = grouped[currentActiveIndex] ?? grouped[0];

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (grouped.length <= 1) return;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (index + 1) % grouped.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (index - 1 + grouped.length) % grouped.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = grouped.length - 1;
    }

    if (nextIndex !== null) {
      const nextGroup = grouped[nextIndex];
      if (nextGroup) {
        setActiveHeat(nextGroup.level);
        tabsRef.current[nextIndex]?.focus();
      }
    }
  };

  const getTabId = (level: string) =>
    `flavour-tab-${baseId}-${level.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  const getPanelId = (level: string) =>
    `flavour-panel-${baseId}-${level.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

  return (
    <div className="builder-flavour-picker">
      <div className="builder-heat-tabs" role="tablist" aria-label="Flavour heat levels">
        {grouped.map((group, idx) => {
          const isSelected = group.level === activeHeat;
          return (
            <button
              key={group.level}
              ref={(el) => {
                tabsRef.current[idx] = el;
              }}
              id={getTabId(group.level)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={getPanelId(group.level)}
              tabIndex={isSelected ? 0 : -1}
              className={`builder-heat-tab${isSelected ? " builder-heat-tab-active" : ""}`}
              onClick={() => setActiveHeat(group.level)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              disabled={disabled}
            >
              {group.level.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>

      <div
        id={getPanelId(activeGroup?.level ?? "")}
        role="tabpanel"
        aria-labelledby={getTabId(activeGroup?.level ?? "")}
        className="builder-heat-tabpanel"
        tabIndex={0}
      >
        <div
          className="builder-flavour-pills"
          role="radiogroup"
          aria-label={`${activeGroup?.level.replace(/_/g, " ")} flavours`}
        >
          {activeGroup?.items.map((flavour) => (
            <button
              key={flavour.id}
              type="button"
              role="radio"
              aria-checked={flavour.id === selectedFlavourId}
              className={`builder-flavour-pill${flavour.id === selectedFlavourId ? " builder-flavour-pill-active" : ""}`}
              onClick={() => onSelect(flavour)}
              disabled={disabled}
            >
              {flavour.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const options = getSaucingOptions(
    effectiveSaucedCount,
    slotCount,
    partyFiveSpecial,
    threeFlavourTellUsHow,
  );
  const showSideQuestion = methodRequiresSideFlavourPick(
    effectiveSaucedCount,
    value,
  );
  const sideQuestionLabel =
    effectiveSaucedCount === 2
      ? "Which flavour goes on the side?"
      : "Which flavour do you want on the side?";

  return (
    <div className="builder-saucing-picker">
      <div className="builder-option-pills" role="radiogroup" aria-label="Saucing method">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`builder-option-pill${value === option.value ? " builder-option-pill-active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showSideQuestion ? (
        <div className="builder-side-flavour-sub" style={{ marginTop: "0.75rem" }}>
          <p className="builder-inline-copy" style={{ marginBottom: "0.5rem" }}>
            {sideQuestionLabel}
          </p>
          <div className="builder-option-pills" role="radiogroup" aria-label={sideQuestionLabel}>
            {sideFlavourOptions.map(({ slotNo, label }) => {
              return (
                <button
                  key={slotNo}
                  type="button"
                  role="radio"
                  aria-checked={sideFlavourSlot === slotNo}
                  className={`builder-option-pill${sideFlavourSlot === slotNo ? " builder-option-pill-active" : ""}`}
                  onClick={() => onSideFlavourSlotChange?.(slotNo)}
                  disabled={!onSideFlavourSlotChange}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const EXTRA_FLAVOUR_TABS = [
  { label: "None / Plain", levels: ["PLAIN"] },
  { label: "Mild", levels: ["MILD"] },
  { label: "Medium", levels: ["MEDIUM"] },
  { label: "Hot", levels: ["HOT"] },
  { label: "Dry Rubs", levels: ["DRY_RUB"] },
] as const;

/** Paid extra flavour: plain / no flavour is not offered (customer already has base flavours). */
const EXTRA_FLAVOUR_TABS_PAID = EXTRA_FLAVOUR_TABS.filter(
  (tab) => !(tab.levels.length === 1 && tab.levels[0] === "PLAIN"),
);

export function ExtraFlavourPicker({
  flavours,
  selectedFlavourId,
  onSelect,
  disabled = false,
}: FlavourPickerProps) {
  const grouped = useMemo(() => {
    return EXTRA_FLAVOUR_TABS_PAID.map((tab) => ({
      label: tab.label,
      items: flavours
        .filter((f) => {
          const level = getHeatLevel(f);
          return (tab.levels as readonly string[]).includes(level);
        })
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        ),
    })).filter((tab) => tab.items.length > 0);
  }, [flavours]);

  const selectedTab = useMemo(() => {
    const selected = flavours.find((f) => f.id === selectedFlavourId);
    if (!selected) {
      return grouped[0]?.label ?? EXTRA_FLAVOUR_TABS_PAID[0]?.label ?? "Mild";
    }
    const level = getHeatLevel(selected);
    const match = EXTRA_FLAVOUR_TABS_PAID.find((tab) =>
      (tab.levels as readonly string[]).includes(level),
    );
    return match?.label ?? grouped[0]?.label ?? EXTRA_FLAVOUR_TABS_PAID[0]?.label ?? "Mild";
  }, [flavours, grouped, selectedFlavourId]);

  const [activeTab, setActiveTab] = useState(selectedTab);

  useEffect(() => {
    setActiveTab(selectedTab);
  }, [selectedTab]);

  const baseId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = grouped.findIndex((g) => g.label === activeTab);
  const currentActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeGroup = grouped[currentActiveIndex] ?? grouped[0];

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (grouped.length <= 1) return;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (index + 1) % grouped.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (index - 1 + grouped.length) % grouped.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = grouped.length - 1;
    }

    if (nextIndex !== null) {
      const nextGroup = grouped[nextIndex];
      if (nextGroup) {
        setActiveTab(nextGroup.label);
        tabsRef.current[nextIndex]?.focus();
      }
    }
  };

  const getTabId = (label: string) =>
    `extra-flavour-tab-${baseId}-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  const getPanelId = (label: string) =>
    `extra-flavour-panel-${baseId}-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

  return (
    <div className="builder-flavour-picker">
      <div className="builder-heat-tabs" role="tablist" aria-label="Extra flavour groups">
        {grouped.map((group, idx) => {
          const isSelected = group.label === activeTab;
          return (
            <button
              key={group.label}
              ref={(el) => {
                tabsRef.current[idx] = el;
              }}
              id={getTabId(group.label)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={getPanelId(group.label)}
              tabIndex={isSelected ? 0 : -1}
              className={`builder-heat-tab${isSelected ? " builder-heat-tab-active" : ""}`}
              onClick={() => setActiveTab(group.label)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              disabled={disabled}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      <div
        id={getPanelId(activeGroup?.label ?? "")}
        role="tabpanel"
        aria-labelledby={getTabId(activeGroup?.label ?? "")}
        className="builder-heat-tabpanel"
        tabIndex={0}
      >
        <div className="builder-flavour-pills" role="radiogroup" aria-label={`${activeGroup?.label} flavours`}>
          {activeGroup?.items.map((flavour) => (
            <button
              key={flavour.id}
              type="button"
              role="radio"
              aria-checked={flavour.id === selectedFlavourId}
              className={`builder-flavour-pill${flavour.id === selectedFlavourId ? " builder-flavour-pill-active" : ""}`}
              onClick={() => onSelect(flavour)}
              disabled={disabled}
            >
              {flavour.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExtraFlavourPrice() {
  return <span className="price-text">{cents(EXTRA_FLAVOUR_PRICE_CENTS)}</span>;
}
