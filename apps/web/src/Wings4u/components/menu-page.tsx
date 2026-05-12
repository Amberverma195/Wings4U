"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiJson } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useDeliveryAddress } from "@/components/delivery-address-provider";
import { hasCompleteDeliveryAddress } from "@/lib/delivery-address";
import {
  getDeliveryUnavailableMessage,
} from "@/lib/delivery-restrictions";
import { isFocusInsideWkMethodOverlay, isTargetInsideWkMethodOverlay } from "@/lib/wk-overlay";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import {
  buildScheduleDateOptions,
  buildScheduleTimeOptions,
  formatScheduleDateLabel,
  formatScheduleTimeLabel,
  getDateKey,
  getSelectedDateKey,
  normalizeSchedulingConfig,
} from "@/lib/order-scheduling";
import { styles } from "../styles";
import {
  buildDisplayMenuCategories,
  ensureSaladsCategoryInDisplay,
  sortMenuCategories,
  type DisplayMenuCategory,
  type DisplayMenuItem,
  type LegacySizePickerGroup,
} from "../menu-display";
import type {
  CartItem,
  FulfillmentType,
  MenuCategory,
  MenuItem as ApiMenuItem,
  MenuResponse,
} from "@/lib/types";
import { ComboBuilder } from "@/components/combo-builder";
import { ItemCustomizationOverlay } from "@/components/item-customization-overlay";
import { ItemModal } from "@/components/item-modal";
import { LegacySizePickerModal } from "@/components/legacy-size-picker-modal";
import { LunchSpecialBuilder } from "@/components/lunch-special-builder";
import {
  canQuickAddMenuItem,
  isComboBuilderItem,
  isLunchSpecialBuilderItem,
  isWingBuilderItem,
  shouldUseCustomizationOverlay,
} from "@/lib/menu-item-customization";
import { WingsBuilder } from "@/components/wings-builder";
import { OrderMethodModal } from "./order-method-modal";
import { CART_EDIT_STORAGE_KEY } from "./cart-page";
import { MenuSkeleton } from "./menu-skeleton";

/**
 * Cart lines store the concrete SKU id (e.g. wings-1lb). The wings / wing-combo
 * rows are synthetic cards whose `id` is not that SKU; real ids live on
 * `weight_options` / `combo_options` (see catalog `buildSyntheticCard`).
 */
function findMenuItemForCartEditLine(
  categories: MenuCategory[],
  menuItemId: string,
): ApiMenuItem | null {
  for (const category of categories) {
    const direct = category.items.find((item) => item.id === menuItemId);
    if (direct) return direct;
  }
  for (const category of categories) {
    for (const item of category.items) {
      if (item.weight_options?.some((opt) => opt.menu_item_id === menuItemId)) {
        return item;
      }
      if (item.combo_options?.some((opt) => opt.menu_item_id === menuItemId)) {
        return item;
      }
    }
  }
  return null;
}

function emojiForCategorySlug(slug: string): string {
  switch (slug) {
    case "lunch-specials":
      return "\uD83E\uDD6A";
    case "wings":
    case "wing-combos":
      return "\uD83C\uDF57";
    case "burgers":
      return "\uD83C\uDF54";
    case "tenders":
      return "\uD83C\uDF57";
    case "wraps":
      return "\uD83C\uDF2F";
    case "salads":
      return "\uD83E\uDD57";
    case "poutines-and-sides":
    case "specialty-fries":
      return "\uD83C\uDF5F";
    case "appetizers":
    case "appetizers-extras":
      return "\uD83C\uDF64";
    case "breads":
      return "\uD83C\uDF5E";
    case "dips":
      return "\uD83E\uDD63";
    case "drinks":
      return "\uD83E\uDD64";
    case "dessert":
      return "\uD83C\uDF70";
    case "specials":
    case "party-specials":
      return "\u2B50";
    default:
      return "\uD83C\uDF7D\uFE0F";
  }
}

function categoryNoteForSlug(slug: string): { text: string } | null {
  switch (slug) {
    case "burgers":
      return {
        text: "All buns are toasted with butter.",
      };
    case "wing-combos":
      return { text: "Side options for combos: Fries, Onion Rings, Wedges or Coleslaw" };
    default:
      return null;
  }
}

function OrderMetaIcon({ kind }: { kind: "date" | "time" | "address" }) {
  if (kind === "date") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="2.25"
          y="3.25"
          width="11.5"
          height="10.5"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M5 1.75v3M11 1.75v3M2.5 6.25h11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === "address") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 14s4.25-4.54 4.25-8.08A4.25 4.25 0 1 0 3.75 5.92C3.75 9.46 8 14 8 14Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 4.75V8l2.25 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MenuPage({
  requestedFulfillmentType = null,
}: {
  requestedFulfillmentType?: FulfillmentType | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationId = DEFAULT_LOCATION_ID;
  const {
    commitOrderContext,
    hasCommittedOrderContext,
    addItem,
    items: cartItems,
    removeItem,
    updateQuantity,
    fulfillmentType: cartFulfillmentType,
    scheduledFor,
    schedulingConfig,
    setLocationTimezone,
    setFulfillmentType,
    setSchedulingConfig,
  } = useCart();
  const committedFulfillmentType =
    requestedFulfillmentType ?? cartFulfillmentType;

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [pickerItem, setPickerItem] = useState<ApiMenuItem | null>(null);
  // Phase 13: when set, the picker for this item opens in "edit" mode and
  // the corresponding cart line is replaced on submit instead of appended.
  const [editingLine, setEditingLine] = useState<CartItem | null>(null);
  const [legacyPickerGroup, setLegacyPickerGroup] = useState<LegacySizePickerGroup | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [orderSettingsOpen, setOrderSettingsOpen] = useState(false);
  const [draftFulfillmentType, setDraftFulfillmentType] =
    useState<FulfillmentType>(committedFulfillmentType);
  const [draftDateKey, setDraftDateKey] = useState(() =>
    getSelectedDateKey(scheduledFor),
  );
  const [draftTimeValue, setDraftTimeValue] = useState(() =>
    scheduledFor ?? "ASAP",
  );
  const [deliveryAddressError, setDeliveryAddressError] = useState<string | null>(null);
  const [isCommittingFulfillment, setIsCommittingFulfillment] = useState(false);
  /** JS-pinned bar (not CSS sticky): follows scroll until it meets the nav, then stays under it. */
  const [orderStackPinned, setOrderStackPinned] = useState(false);
  const [orderStackHeight, setOrderStackHeight] = useState(0);
  const [orderStackPinRect, setOrderStackPinRect] = useState<{ left: number; width: number } | null>(
    null,
  );
  const { address: deliveryAddress, openAddressPicker } = useDeliveryAddress();
  const hasSelectedDeliveryAddress = hasCompleteDeliveryAddress(deliveryAddress);
  const deliveryUnavailableMessage = getDeliveryUnavailableMessage(menu);
  const deliveryUnavailable = Boolean(deliveryUnavailableMessage);

  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const catRowRef = useRef<HTMLDivElement | null>(null);
  const menuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const orderStackPinSentinelRef = useRef<HTMLDivElement | null>(null);
  const stickyStackRef = useRef<HTMLDivElement | null>(null);
  const orderSettingsRef = useRef<HTMLDivElement | null>(null);
  const orderStackPinnedRef = useRef(false);
  const isScrollingToRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const didScrollToHashRef = useRef(false);
  const didScrollToCategorySlugRef = useRef<string | null>(null);

  const displayCategories = useMemo<DisplayMenuCategory[]>(
    () =>
      ensureSaladsCategoryInDisplay(
        buildDisplayMenuCategories(sortMenuCategories(menu?.categories ?? [])),
      ),
    [menu?.categories],
  );
  const schedulingHours = useMemo(
    () =>
      menu
        ? {
            pickup: menu.location.pickup_hours,
            delivery: menu.location.delivery_hours,
            store: menu.location.store_hours ?? [],
          }
        : undefined,
    [menu],
  );
  const saladMenuItems = useMemo(
    () =>
      menu?.categories.find((category) => category.slug === "salads")?.items ?? [],
    [menu?.categories],
  );
  const draftDateOptions = useMemo(
    () =>
      buildScheduleDateOptions(
        draftFulfillmentType,
        schedulingHours,
        menu?.location.timezone,
      ),
    [draftFulfillmentType, menu?.location.timezone, schedulingHours],
  );
  const draftTimeOptions = useMemo(
    () =>
      buildScheduleTimeOptions({
        fulfillmentType: draftFulfillmentType,
        selectedDateKey: draftDateKey,
        config: schedulingConfig,
        hours: schedulingHours,
        timezone: menu?.location.timezone,
      }),
    [draftDateKey, draftFulfillmentType, menu?.location.timezone, schedulingConfig, schedulingHours],
  );
  const scheduleDateLabel = formatScheduleDateLabel(
    scheduledFor,
    menu?.location.timezone,
  );
  const scheduleTimeLabel = formatScheduleTimeLabel(
    scheduledFor,
    committedFulfillmentType,
    schedulingConfig,
    menu?.location.timezone,
  );

  const getCategoryAnchorY = useCallback(() => {
    const stickyBottom = stickyStackRef.current?.getBoundingClientRect().bottom;
    if (typeof stickyBottom === "number" && Number.isFinite(stickyBottom) && stickyBottom > 0) {
      return Math.ceil(stickyBottom) + 12;
    }

    const navEl = document.querySelector(".wk-nav-bar") as HTMLElement | null;
    return Math.ceil(navEl?.getBoundingClientRect().height ?? 0) + 12;
  }, []);

  const getCategoryScrollTop = useCallback(
    (sectionEl: HTMLElement) =>
      Math.max(window.scrollY + sectionEl.getBoundingClientRect().top - getCategoryAnchorY(), 0),
    [getCategoryAnchorY],
  );

  const syncDraftOrderSettings = useCallback(() => {
    setDraftFulfillmentType(committedFulfillmentType);
    setDraftDateKey(getSelectedDateKey(scheduledFor));
    setDraftTimeValue(scheduledFor ?? "ASAP");
  }, [committedFulfillmentType, scheduledFor]);

  const showDeliveryAddressError = useCallback(() => {
    setDeliveryAddressError("Choose a delivery address to continue.");
  }, []);

  const handleDraftFulfillmentTypeChange = useCallback(
    (next: FulfillmentType) => {
      if (next === "DELIVERY" && deliveryUnavailable) {
        return;
      }
      setDraftFulfillmentType(next);
      setDeliveryAddressError(null);
    },
    [deliveryUnavailable],
  );

  useEffect(() => {
    if (hasCommittedOrderContext && requestedFulfillmentType) {
      setFulfillmentType(requestedFulfillmentType);
    }
    syncDraftOrderSettings();
    setIsCommittingFulfillment(false);
  }, [
    hasCommittedOrderContext,
    requestedFulfillmentType,
    setFulfillmentType,
    syncDraftOrderSettings,
  ]);

  useEffect(() => {
    if (draftFulfillmentType !== "DELIVERY" || hasSelectedDeliveryAddress) {
      setDeliveryAddressError(null);
    }
  }, [draftFulfillmentType, hasSelectedDeliveryAddress]);

  useEffect(() => {
    if (!menu) return;

    setLocationTimezone(menu.location.timezone);

    const nextSchedulingConfig = normalizeSchedulingConfig({
      pickup: {
        minMinutes: menu.location.pickup_min_minutes,
        maxMinutes: menu.location.pickup_max_minutes,
      },
      delivery: {
        minMinutes: menu.location.delivery_min_minutes,
        maxMinutes: menu.location.delivery_max_minutes,
      },
    });

    const configChanged =
      schedulingConfig.pickup.minMinutes !== nextSchedulingConfig.pickup.minMinutes ||
      schedulingConfig.pickup.maxMinutes !== nextSchedulingConfig.pickup.maxMinutes ||
      schedulingConfig.delivery.minMinutes !== nextSchedulingConfig.delivery.minMinutes ||
      schedulingConfig.delivery.maxMinutes !== nextSchedulingConfig.delivery.maxMinutes;

    if (configChanged) {
      setSchedulingConfig(nextSchedulingConfig);
    }
  }, [menu, schedulingConfig, setLocationTimezone, setSchedulingConfig]);

  useEffect(() => {
    if (!hasCommittedOrderContext) return;

    let cancelled = false;

    async function load() {
      setError(null);
      setMenu(null);

      const query = new URLSearchParams({
        location_id: locationId,
        fulfillment_type: committedFulfillmentType,
      });
      if (scheduledFor) {
        query.set("scheduled_for", scheduledFor);
      }

      try {
        const response = await apiJson<MenuResponse>(
          `/api/v1/menu?${query.toString()}`,
          { locationId },
        );

        if (cancelled) return;

        if (!response.data) {
          setError("Menu response missing data");
          setMenu(null);
          return;
        }

        setMenu(response.data);
        if (response.data.categories.length > 0) {
          setActiveCategoryId(response.data.categories[0].id);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load menu");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [committedFulfillmentType, hasCommittedOrderContext, locationId, scheduledFor]);

  /**
   * Sync ?fulfillment_type= from persisted cart when the URL omits it (e.g. "Back to menu"
   * links to `/order` without a query). Only runs after the user has committed order context
   * once; first-time visitors still see OrderMethodModal first (`!hasCommittedOrderContext`).
   */
  useEffect(() => {
    if (!hasCommittedOrderContext || requestedFulfillmentType) return;

    if (pathname === "/order") {
      const ft = searchParams.get("fulfillment_type");
      if (ft !== "DELIVERY" && ft !== "PICKUP") {
        const params = new URLSearchParams(searchParams.toString());
        params.set("fulfillment_type", committedFulfillmentType);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        return;
      }
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("fulfillment_type", committedFulfillmentType);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [
    committedFulfillmentType,
    hasCommittedOrderContext,
    pathname,
    requestedFulfillmentType,
    router,
    searchParams,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const stackEl = stickyStackRef.current;
    if (!stackEl) return;

    const root = document.documentElement;
    const navEl = document.querySelector(".wk-nav-bar") as HTMLElement | null;

    /** Pin flush to the nav bottom — any gap lets scroll content show between nav and the bar. */
    const NAV_TOP_GAP_PX = 0;

    const syncPinLayoutFromSurface = () => {
      const surface = menuSurfaceRef.current;
      if (!surface) return;
      const r = surface.getBoundingClientRect();
      const cs = getComputedStyle(surface);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      setOrderStackPinRect({ left: r.left + pl, width: r.width - pl - pr });
    };

    const syncOffsets = () => {
      const navHeight = Math.round(navEl?.getBoundingClientRect().height ?? 0);
      const stackHeight = Math.ceil(stackEl.getBoundingClientRect().height ?? 0);
      const offsetPx = navHeight > 0 ? navHeight + NAV_TOP_GAP_PX : 68;

      root.style.setProperty("--wk-nav-offset", `${offsetPx}px`);
      root.style.setProperty("--wk-order-stack-offset", `${offsetPx + stackHeight}px`);
      setOrderStackHeight(stackHeight);
    };

    const updatePin = () => {
      const sentinel = orderStackPinSentinelRef.current;
      if (!sentinel) return;

      const navHeight = Math.round(navEl?.getBoundingClientRect().height ?? 0);
      const threshold = (navHeight > 0 ? navHeight : 64) + NAV_TOP_GAP_PX;
      const nextPin = sentinel.getBoundingClientRect().top <= threshold;

      if (nextPin === orderStackPinnedRef.current) {
        if (nextPin) syncPinLayoutFromSurface();
        return;
      }

      orderStackPinnedRef.current = nextPin;
      setOrderStackPinned(nextPin);

      if (nextPin) {
        const rect = stackEl.getBoundingClientRect();
        setOrderStackPinRect({ left: rect.left, width: rect.width });
      } else {
        setOrderStackPinRect(null);
      }
    };

    const tick = () => {
      syncOffsets();
      updatePin();
      if (orderStackPinnedRef.current) {
        syncPinLayoutFromSurface();
      }
    };

    tick();

    const surfaceEl = menuSurfaceRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(tick) : null;

    if (observer) {
      if (navEl) observer.observe(navEl);
      if (surfaceEl) observer.observe(surfaceEl);
      observer.observe(stackEl);
    }

    window.addEventListener("resize", tick);
    window.addEventListener("scroll", updatePin, { passive: true });

    return () => {
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", updatePin);
      observer?.disconnect();
    };
  }, [orderSettingsOpen, menu?.categories.length]);

  useEffect(() => {
    orderStackPinnedRef.current = orderStackPinned;
  }, [orderStackPinned]);

  const dismissOrderSettings = useCallback(() => {
    setOrderSettingsOpen(false);
    setDeliveryAddressError(null);
    syncDraftOrderSettings();
  }, [syncDraftOrderSettings]);

  useEffect(() => {
    if (!orderSettingsOpen) return;
    if (!draftDateOptions.some((option) => option.value === draftDateKey)) {
      setDraftDateKey(draftDateOptions[0]?.value ?? getDateKey(new Date()));
    }
  }, [draftDateKey, draftDateOptions, orderSettingsOpen]);

  useEffect(() => {
    if (!orderSettingsOpen) return;
    if (!draftTimeOptions.some((option) => option.value === draftTimeValue)) {
      setDraftTimeValue(draftTimeOptions[0]?.value ?? "ASAP");
    }
  }, [draftTimeOptions, draftTimeValue, orderSettingsOpen]);

  useEffect(() => {
    if (!orderSettingsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (isTargetInsideWkMethodOverlay(event.target)) return;
      const target = event.target as Node | null;
      if (target && orderSettingsRef.current?.contains(target)) return;
      dismissOrderSettings();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isTargetInsideWkMethodOverlay(event.target) || isFocusInsideWkMethodOverlay()) return;
      dismissOrderSettings();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissOrderSettings, orderSettingsOpen]);

  useEffect(() => {
    const categories = displayCategories;
    if (!categories.length) return;

    function syncActiveCategoryFromScroll() {
      if (isScrollingToRef.current) return;

      const anchorY = getCategoryAnchorY();
      let bestCategoryId = categories[0]?.id ?? null;

      for (const category of categories) {
        const sectionEl = sectionRefs.current.get(`cat-${category.id}`);
        if (!sectionEl) continue;

        if (sectionEl.getBoundingClientRect().top <= anchorY) {
          bestCategoryId = category.id;
        } else {
          break;
        }
      }

      if (bestCategoryId) {
        setActiveCategoryId((previous) =>
          previous === bestCategoryId ? previous : bestCategoryId,
        );
      }
    }

    syncActiveCategoryFromScroll();
    window.addEventListener("scroll", syncActiveCategoryFromScroll, { passive: true });
    window.addEventListener("resize", syncActiveCategoryFromScroll);

    return () => {
      window.removeEventListener("scroll", syncActiveCategoryFromScroll);
      window.removeEventListener("resize", syncActiveCategoryFromScroll);
    };
  }, [displayCategories, getCategoryAnchorY]);

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 600);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* Keep the active category pill in view horizontally only. `scrollIntoView` on the pill
   * can scroll the *page* vertically (to satisfy “nearest” in the viewport), which feels
   * like the menu is pulling you back up while you scroll — so we only adjust scrollLeft. */
  useEffect(() => {
    if (!activeCategoryId || !catRowRef.current) return;

    const row = catRowRef.current;
    const activeButton = row.querySelector(
      `[data-cat-id="${activeCategoryId}"]`,
    ) as HTMLElement | null;
    if (!activeButton) return;

    const rowWidth = row.clientWidth;
    const btnLeft = activeButton.offsetLeft;
    const btnWidth = activeButton.offsetWidth;
    const targetLeft = btnLeft - (rowWidth - btnWidth) / 2;

    row.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth",
    });
  }, [activeCategoryId]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
    };
  }, []);

  const scrollToCategory = useCallback(
    (categoryId: string) => {
      if (isCommittingFulfillment) return;

      dismissOrderSettings();

      const sectionEl = sectionRefs.current.get(`cat-${categoryId}`);
      if (!sectionEl) return;

      isScrollingToRef.current = true;
      setActiveCategoryId(categoryId);
      window.scrollTo({
        top: getCategoryScrollTop(sectionEl),
        behavior: "smooth",
      });

      window.setTimeout(() => {
        isScrollingToRef.current = false;
      }, 1200);
    },
    [dismissOrderSettings, getCategoryScrollTop, isCommittingFulfillment],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!displayCategories.length || didScrollToHashRef.current) return;

    const hash = window.location.hash;
    if (!hash.startsWith("#cat-")) return;

    const categoryId = decodeURIComponent(hash.slice("#cat-".length));
    if (!displayCategories.some((c) => c.id === categoryId)) return;

    didScrollToHashRef.current = true;

    const timer = window.setTimeout(() => {
      scrollToCategory(categoryId);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [displayCategories, scrollToCategory]);

  useEffect(() => {
    const categorySlug = searchParams.get("cat")?.trim().toLowerCase() ?? null;
    if (!categorySlug || !displayCategories.length) return;

    const targetCategory = displayCategories.find(
      (category) => category.slug === categorySlug,
    );
    if (!targetCategory) return;
    if (didScrollToCategorySlugRef.current === categorySlug) return;

    didScrollToCategorySlugRef.current = categorySlug;

    const timer = window.setTimeout(() => {
      scrollToCategory(targetCategory.id);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [displayCategories, scrollToCategory, searchParams]);

  // Phase 13: when the cart page hands off an "edit this line" intent via
  // sessionStorage, find the matching cart line + menu item once the menu
  // has loaded and pop the right builder open in editing mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!menu) return;

    const editKey = window.sessionStorage.getItem(CART_EDIT_STORAGE_KEY);
    if (!editKey) return;

    const targetLine = cartItems.find((line) => line.key === editKey);
    if (!targetLine) {
      window.sessionStorage.removeItem(CART_EDIT_STORAGE_KEY);
      return;
    }

    const targetMenuItem = findMenuItemForCartEditLine(
      menu.categories,
      targetLine.menu_item_id,
    );

    if (!targetMenuItem) {
      window.sessionStorage.removeItem(CART_EDIT_STORAGE_KEY);
      return;
    }

    setEditingLine(targetLine);
    setPickerItem(targetMenuItem);
    window.sessionStorage.removeItem(CART_EDIT_STORAGE_KEY);
  }, [cartItems, menu]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const toggleOrderSettings = useCallback(() => {
    if (isCommittingFulfillment) return;

    if (!orderSettingsOpen) {
      syncDraftOrderSettings();
      setOrderSettingsOpen(true);
      return;
    }

    if (draftFulfillmentType === "DELIVERY" && deliveryUnavailable) {
      return;
    }

    if (draftFulfillmentType === "DELIVERY" && !hasSelectedDeliveryAddress) {
      showDeliveryAddressError();
      return;
    }

    const nextScheduledFor = draftTimeValue === "ASAP" ? null : draftTimeValue;
    const fulfillmentChanged =
      draftFulfillmentType !== committedFulfillmentType;
    const scheduleChanged = nextScheduledFor !== scheduledFor;

    if (!fulfillmentChanged && !scheduleChanged) {
      dismissOrderSettings();
      return;
    }

    setOrderSettingsOpen(false);
    setMenu(null);
    commitOrderContext({
      fulfillmentType: draftFulfillmentType,
      scheduledFor: nextScheduledFor,
    });

    if (!fulfillmentChanged) {
      return;
    }

    setIsCommittingFulfillment(true);

    const params = new URLSearchParams(searchParams.toString());
    params.set("fulfillment_type", draftFulfillmentType);
    const nextUrl = `${pathname}?${params.toString()}`;

    commitTimerRef.current = window.setTimeout(() => {
      router.push(nextUrl, { scroll: false });
    }, 140);
  }, [
    commitOrderContext,
    committedFulfillmentType,
    dismissOrderSettings,
    draftTimeValue,
    draftFulfillmentType,
    deliveryUnavailable,
    hasSelectedDeliveryAddress,
    isCommittingFulfillment,
    orderSettingsOpen,
    pathname,
    router,
    scheduledFor,
    searchParams,
    showDeliveryAddressError,
    syncDraftOrderSettings,
  ]);

  const cartCountForItem = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of cartItems) {
      counts.set(item.menu_item_id, (counts.get(item.menu_item_id) ?? 0) + item.quantity);
    }

    return counts;
  }, [cartItems]);

  const cartCountForDisplayItem = useCallback(
    (displayItem: DisplayMenuItem) =>
      displayItem.cartMenuItemIds.reduce(
        (sum, menuItemId) => sum + (cartCountForItem.get(menuItemId) ?? 0),
        0,
      ),
    [cartCountForItem],
  );

  // Phase 11: scan from the end so the +/- controls always act on the
  // most recently added line — that's the line the customer sees grow
  // when they keep tapping +.
  const findLatestCartLineForDisplayItem = useCallback(
    (displayItem: DisplayMenuItem) => {
      const targetIds = new Set(displayItem.cartMenuItemIds);
      for (let index = cartItems.length - 1; index >= 0; index -= 1) {
        const line = cartItems[index];
        if (targetIds.has(line.menu_item_id)) return line;
      }
      return null;
    },
    [cartItems],
  );

  const renderCard = useCallback(
    (category: Pick<MenuCategory, "slug">, item: DisplayMenuItem) => {
      const emoji = emojiForCategorySlug(category.slug);
      const price = item.displayPriceCents / 100;
      const quantityInCart = cartCountForDisplayItem(item);
      const description = item.displayDescription?.trim();
      const imageUrl =
        item.kind === "item"
          ? item.item.image_url
          : item.group.options.find((option) => option.item.image_url)?.item.image_url ?? null;

      const handleAddClick = () => {
        if (item.kind === "legacy-group") {
          setLegacyPickerGroup(item.group);
          return;
        }

        if (canQuickAddMenuItem(item.item)) {
          addItem({
            menu_item_id: item.item.id,
            menu_item_slug: item.item.slug,
            name: item.item.name,
            image_url: item.item.image_url,
            base_price_cents: item.item.base_price_cents,
            quantity: 1,
            modifier_selections: [],
            special_instructions: "",
          });
          return;
        }

        setPickerItem(item.item);
      };

      // Phase 11: when the item is already in the cart, swap the
      // ADD TO CART button for inline +/- controls. The minus button
      // decrements (or removes) the most recent line for this item; the
      // plus button reuses handleAddClick so builder items still re-open
      // their builder for a fresh round of selections.
      const handleDecrement = () => {
        const line = findLatestCartLineForDisplayItem(item);
        if (!line) return;
        if (line.quantity <= 1) {
          removeItem(line.key);
        } else {
          updateQuantity(line.key, line.quantity - 1);
        }
      };

      return (
        <div key={item.key} style={{ ...styles.menuCard, ...(item.stockStatus === "UNAVAILABLE" ? { opacity: 0.5, pointerEvents: "none" } : {}) }}>
          {imageUrl ? (
            <div style={styles.menuCardImageWrap}>
              <img
                src={imageUrl}
                alt={item.displayName}
                style={styles.menuCardImage}
              />
            </div>
          ) : (
            <div style={styles.menuCardEmoji}>{emoji}</div>
          )}
          <div style={styles.menuCardBody}>
            <div style={styles.menuCardCopy}>
              <h3 style={styles.menuCardName}>
                {item.displayName}
                {item.stockStatus === "LOW_STOCK" && (
                  <span style={{ marginLeft: 8, fontSize: "0.7rem", padding: "2px 6px", background: "rgba(245,158,11,0.2)", color: "#fbbf24", borderRadius: 4, textTransform: "uppercase", verticalAlign: "middle" }}>Low Stock</span>
                )}
              </h3>
              {category.slug === "salads" ? (
                <p
                  style={styles.menuCardSaladSizes}
                  className="menu-card-item-desc menu-card-salad-sizes"
                >
                  Size: Small, Large
                </p>
              ) : null}
              {description ? (
                <p className="menu-card-item-desc" style={styles.menuCardDesc}>
                  {description}
                </p>
              ) : (
                <div style={styles.menuCardDescPlaceholder} aria-hidden="true" />
              )}
            </div>
            <div style={styles.menuCardFooter}>
              <span style={styles.menuCardPrice}>
                {item.showStartingAt ? "From " : ""}${price.toFixed(2)}
              </span>
              {item.stockStatus === "UNAVAILABLE" ? (
                <button
                  type="button"
                  className="menu-add-to-cart-btn"
                  style={{ ...styles.addBtn, background: "#27272a", color: "#71717a", borderColor: "transparent" }}
                  disabled
                >
                  UNAVAILABLE
                </button>
              ) : quantityInCart > 0 ? (
                <div style={styles.menuCardQtyGroup}>
                  <button
                    type="button"
                    style={styles.menuCardQtyBtn}
                    onClick={handleDecrement}
                    aria-label={`Remove one ${item.displayName}`}
                  >
                    −
                  </button>
                  <span style={styles.menuCardQtyValue}>{quantityInCart}</span>
                  <button
                    type="button"
                    style={styles.menuCardQtyBtn}
                    onClick={handleAddClick}
                    aria-label={`Add another ${item.displayName}`}
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="menu-add-to-cart-btn"
                  style={styles.addBtn}
                  onClick={handleAddClick}
                >
                  ADD TO CART
                </button>
              )}
            </div>
          </div>
        </div>
      );
    },
    [
      addItem,
      cartCountForDisplayItem,
      findLatestCartLineForDisplayItem,
      removeItem,
      updateQuantity,
    ],
  );

  /**
   * Show the pickup/delivery panel only until the user commits once (stored in sessionStorage).
   * After that, `commitOrderContext` + URL sync reuse the same fulfillment across the site;
   * links like `/order` without `?fulfillment_type=` no longer re-open the modal.
   */
  const needOrderMethodModal = !hasCommittedOrderContext;

  if (needOrderMethodModal) {
    return (
      <>
        <MenuSkeleton statusLabel="Select order settings" />
        <OrderMethodModal
          open
          defaultMethod={requestedFulfillmentType ?? "DELIVERY"}
          initialScheduledFor={scheduledFor}
          onClose={() => {
            router.push("/");
          }}
          onContinue={({ fulfillment_type, scheduled_for }) => {
            commitOrderContext({
              fulfillmentType: fulfillment_type,
              scheduledFor: scheduled_for,
            });

            const params = new URLSearchParams(searchParams.toString());
            params.set("fulfillment_type", fulfillment_type);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }}
        />
      </>
    );
  }

  if (error) {
    return (
      <div style={styles.menuPage}>
        <div style={{ ...styles.menuSurface, paddingTop: "clamp(1.25rem, 2vw, 2rem)" }}>
          <p style={{ ...styles.menuSub, marginBottom: 8 }}>{error}</p>
          <p style={{ color: "#5c432f", margin: 0, fontSize: 14 }}>
            Check that the API is running, that Next was restarted after changing
            apps/web/.env.local, and that NEXT_PUBLIC_DEFAULT_LOCATION_ID matches the
            LON01 location UUID.
          </p>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <MenuSkeleton
        statusLabel={isCommittingFulfillment ? "Updating fulfillment" : "Loading menu"}
      />
    );
  }

  const displayedFulfillmentType = committedFulfillmentType;
  const actionLabel = isCommittingFulfillment
    ? "Loading..."
    : orderSettingsOpen
      ? "Done"
      : "Change";

  return (
    <div style={styles.menuPage}>
      <div ref={menuSurfaceRef} style={styles.menuSurface}>
        <div
          ref={orderStackPinSentinelRef}
          aria-hidden={true}
          style={{ height: 0, margin: 0, padding: 0, pointerEvents: "none" }}
        />
        <div
          style={
            orderStackPinned
              ? { minHeight: orderStackHeight, marginBottom: 18 }
              : undefined
          }
        >
          <div
            className={`wk-order-sticky-stack${orderStackPinned ? " wk-order-sticky-stack--pinned" : ""}`}
            ref={stickyStackRef}
            style={
              orderStackPinned && orderStackPinRect
                ? { left: orderStackPinRect.left, width: orderStackPinRect.width }
                : undefined
            }
          >
          <div className="wk-order-settings-shell" ref={orderSettingsRef}>
            <div className="wk-order-settings-bar">
              <div className="wk-order-fulfillment-display" aria-label="Selected fulfillment type">
                {(["PICKUP", "DELIVERY"] as const).map((option) => (
                  <span
                    key={option}
                    className="wk-order-fulfillment-chip"
                    data-active={displayedFulfillmentType === option ? "true" : "false"}
                  >
                    {option}
                  </span>
                ))}
              </div>

              <div
                className={`wk-order-settings-meta${displayedFulfillmentType === "DELIVERY" ? " wk-order-settings-meta--delivery" : ""}`}
              >
                <div className="wk-order-settings-chip wk-order-settings-chip--date">
                  <span className="wk-order-settings-icon">
                    <OrderMetaIcon kind="date" />
                  </span>
                  <span>{scheduleDateLabel}</span>
                </div>
                <div className="wk-order-settings-chip wk-order-settings-chip--time">
                  <span className="wk-order-settings-icon">
                    <OrderMetaIcon kind="time" />
                  </span>
                  <span>{scheduleTimeLabel}</span>
                </div>
                {displayedFulfillmentType === "DELIVERY" && hasSelectedDeliveryAddress ? (
                  <div className="wk-order-settings-chip wk-order-settings-chip--address">
                    <span className="wk-order-settings-icon">
                      <OrderMetaIcon kind="address" />
                    </span>
                    <span>{deliveryAddress?.line1}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="wk-order-settings-action"
                  onClick={toggleOrderSettings}
                  aria-expanded={orderSettingsOpen}
                  disabled={isCommittingFulfillment}
                >
                  {actionLabel}
                </button>
              </div>
            </div>

            {orderSettingsOpen && (
              <div className="wk-order-settings-panel" role="dialog" aria-label="Order settings">
                <div className="wk-order-settings-panel-header">
                  <span className="wk-order-settings-panel-title">Order settings</span>
                </div>

                <div
                  className="wk-order-settings-panel-toggle"
                  role="tablist"
                  aria-label="Edit fulfillment type"
                >
                  {(["PICKUP", "DELIVERY"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="wk-order-fulfillment-btn"
                      data-active={draftFulfillmentType === option ? "true" : "false"}
                      data-disabled={
                        option === "DELIVERY" && deliveryUnavailable ? "true" : "false"
                      }
                      onClick={() => handleDraftFulfillmentTypeChange(option)}
                      disabled={option === "DELIVERY" && deliveryUnavailable}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                {deliveryUnavailableMessage ? (
                  <p className="wk-order-settings-restriction-note">
                    {deliveryUnavailableMessage}
                  </p>
                ) : null}

                <div className="wk-order-settings-grid">
                  <div className="wk-order-settings-field">
                    <span className="wk-order-settings-field-label">Date</span>
                    <label className="wk-order-settings-select-wrap">
                      <span className="wk-order-settings-select-icon" aria-hidden="true">
                        <OrderMetaIcon kind="date" />
                      </span>
                      <select
                        className="wk-order-settings-select"
                        value={draftDateKey}
                        onChange={(event) => setDraftDateKey(event.target.value)}
                      >
                        {draftDateOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="wk-order-settings-field">
                    <span className="wk-order-settings-field-label">Time</span>
                    <label className="wk-order-settings-select-wrap">
                      <span className="wk-order-settings-select-icon" aria-hidden="true">
                        <OrderMetaIcon kind="time" />
                      </span>
                      <select
                        className="wk-order-settings-select"
                        value={draftTimeValue}
                        onChange={(event) => setDraftTimeValue(event.target.value)}
                      >
                        {draftTimeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                {draftFulfillmentType === "DELIVERY" && (
                  <div
                    className="wk-order-settings-address"
                    data-invalid={deliveryAddressError ? "true" : "false"}
                  >
                    <div className="wk-order-settings-address-header">
                      <span className="wk-order-settings-field-label">Delivery address</span>
                      <button
                        type="button"
                        className="wk-order-settings-address-change"
                        onClick={() => {
                          setDeliveryAddressError(null);
                          openAddressPicker();
                        }}
                      >
                        Choose address
                      </button>
                    </div>
                    {hasSelectedDeliveryAddress ? (
                      <div className="wk-order-settings-address-value">
                        <span>{deliveryAddress.line1}</span>
                        <span>{`${deliveryAddress.city}, ${deliveryAddress.postalCode}`}</span>
                      </div>
                    ) : (
                      <div className="wk-order-settings-address-empty">
                        No delivery address selected yet.
                      </div>
                    )}
                    {deliveryAddressError ? (
                      <p className="wk-order-settings-address-error">{deliveryAddressError}</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="wk-menu-sticky-cats">
            <div className="wk-cat-fade-edge">
              <div className="wk-cat-row" ref={catRowRef}>
                {displayCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className="wk-cat-btn"
                    data-active={activeCategoryId === category.id ? "true" : "false"}
                    data-cat-id={category.id}
                    onClick={() => scrollToCategory(category.id)}
                  >
                    <span className="wk-cat-label">{category.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>

        {displayCategories.map((category) => {
          const note = categoryNoteForSlug(category.slug);

          return (
            <div
              key={category.id}
              id={`cat-${category.id}`}
              className="wk-menu-section"
              ref={(element) => {
                if (element) {
                  sectionRefs.current.set(`cat-${category.id}`, element);
                } else {
                  sectionRefs.current.delete(`cat-${category.id}`);
                }
              }}
            >
              <h2 className="wk-section-heading">{category.name.toUpperCase()}</h2>
              {note && (
                <div
                  className={`wk-section-note${category.slug === "wing-combos" || category.slug === "burgers" ? " wk-section-note--highlight" : ""}`}
                >
                  <span>{note.text}</span>
                </div>
              )}
              {category.slug === "salads" && category.items.length === 0 ? (
                <div className="wk-salads-empty">
                  <p>
                    No salad items are listed for this location yet. After a menu update, reseed
                    the database or sync the catalog so salads appear here.
                  </p>
                </div>
              ) : (
                <div style={styles.menuGrid}>
                  {category.items.map((item) => renderCard(category, item))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showBackToTop && (
        <button className="wk-back-to-top" onClick={scrollToTop} aria-label="Back to top">
          ^
        </button>
      )}

      {pickerItem &&
        (isWingBuilderItem(pickerItem) ? (
          <WingsBuilder
            item={pickerItem}
            saladMenuItems={saladMenuItems}
            editingLine={editingLine ?? undefined}
            onClose={() => {
              setPickerItem(null);
              setEditingLine(null);
            }}
          />
        ) : isComboBuilderItem(pickerItem) ? (
          <ComboBuilder
            item={pickerItem}
            editingLine={editingLine ?? undefined}
            onClose={() => {
              setPickerItem(null);
              setEditingLine(null);
            }}
          />
        ) : isLunchSpecialBuilderItem(pickerItem) ? (
          <LunchSpecialBuilder
            item={pickerItem}
            childItems={
              menu?.categories.find(
                (category) =>
                  category.slug ===
                  (pickerItem.slug === "lunch-burger" ? "burgers" : "wraps"),
              )?.items ?? []
            }
            editingLine={editingLine ?? undefined}
            onClose={() => {
              setPickerItem(null);
              setEditingLine(null);
            }}
          />
        ) : shouldUseCustomizationOverlay(pickerItem) ? (
          <ItemCustomizationOverlay
            item={pickerItem}
            editingLine={editingLine ?? undefined}
            onClose={() => {
              setPickerItem(null);
              setEditingLine(null);
            }}
          />
        ) : (
          <ItemModal item={pickerItem} onClose={() => setPickerItem(null)} />
        ))}

      {legacyPickerGroup && (
        <LegacySizePickerModal
          group={legacyPickerGroup}
          onClose={() => setLegacyPickerGroup(null)}
        />
      )}
    </div>
  );
}
