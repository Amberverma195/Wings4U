"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeliveryAddress } from "@/components/delivery-address-provider";
import { hasCompleteDeliveryAddress } from "@/lib/delivery-address";
import {
  getDeliveryUnavailableMessage,
} from "@/lib/delivery-restrictions";
import { useCart } from "@/lib/cart";
import {
  buildScheduleDateOptions,
  buildScheduleTimeOptions,
  formatScheduleDateLabel,
  formatScheduleTimeLabel,
  getDateKey,
  getSelectedDateKey,
  normalizeSchedulingConfig,
} from "@/lib/order-scheduling";
import { isFocusInsideWkMethodOverlay, isTargetInsideWkMethodOverlay } from "@/lib/wk-overlay";
import type { FulfillmentType, MenuResponse } from "@/lib/types";

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

type Props = {
  menu: MenuResponse | null;
};

/**
 * Same order bar + “Order settings” panel as the menu (/order) page, wired to cart state only.
 */
export function CartOrderSettings({ menu }: Props) {
  const {
    commitOrderContext,
    fulfillmentType,
    scheduledFor,
    schedulingConfig,
    setSchedulingConfig,
  } = useCart();

  const { address: deliveryAddress, openAddressPicker } = useDeliveryAddress();
  const orderSettingsRef = useRef<HTMLDivElement | null>(null);

  const [orderSettingsOpen, setOrderSettingsOpen] = useState(false);
  const [draftFulfillmentType, setDraftFulfillmentType] =
    useState<FulfillmentType>(fulfillmentType);
  const [draftDateKey, setDraftDateKey] = useState(() => getSelectedDateKey(scheduledFor));
  const [draftTimeValue, setDraftTimeValue] = useState(() => scheduledFor ?? "ASAP");
  const [deliveryAddressError, setDeliveryAddressError] = useState<string | null>(null);
  const hasSelectedDeliveryAddress = hasCompleteDeliveryAddress(deliveryAddress);
  const deliveryUnavailableMessage = getDeliveryUnavailableMessage(menu);
  const deliveryUnavailable = Boolean(deliveryUnavailableMessage);

  const schedulingHours = useMemo(
    () =>
      menu
        ? {
            pickup: menu.location.pickup_hours,
            delivery: menu.location.delivery_hours,
          }
        : undefined,
    [menu],
  );

  const draftDateOptions = useMemo(
    () =>
      buildScheduleDateOptions(draftFulfillmentType, schedulingHours, menu?.location.timezone),
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

  const syncDraftOrderSettings = useCallback(() => {
    setDraftFulfillmentType(fulfillmentType);
    setDraftDateKey(getSelectedDateKey(scheduledFor));
    setDraftTimeValue(scheduledFor ?? "ASAP");
  }, [fulfillmentType, scheduledFor]);

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
    syncDraftOrderSettings();
  }, [fulfillmentType, scheduledFor, syncDraftOrderSettings]);

  useEffect(() => {
    if (!menu) return;

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
  }, [menu, schedulingConfig, setSchedulingConfig]);

  const scheduleDateLabel = formatScheduleDateLabel(scheduledFor, menu?.location.timezone);
  const scheduleTimeLabel = formatScheduleTimeLabel(
    scheduledFor,
    fulfillmentType,
    schedulingConfig,
    menu?.location.timezone,
  );

  const dismissOrderSettings = useCallback(() => {
    setOrderSettingsOpen(false);
    setDeliveryAddressError(null);
    syncDraftOrderSettings();
  }, [syncDraftOrderSettings]);

  useEffect(() => {
    if (draftFulfillmentType !== "DELIVERY" || hasSelectedDeliveryAddress) {
      setDeliveryAddressError(null);
    }
  }, [draftFulfillmentType, hasSelectedDeliveryAddress]);

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

  const toggleOrderSettings = useCallback(() => {
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
    const fulfillmentChanged = draftFulfillmentType !== fulfillmentType;
    const scheduleChanged = nextScheduledFor !== scheduledFor;

    if (!fulfillmentChanged && !scheduleChanged) {
      dismissOrderSettings();
      return;
    }

    setOrderSettingsOpen(false);
    commitOrderContext({
      fulfillmentType: draftFulfillmentType,
      scheduledFor: nextScheduledFor,
    });
  }, [
    commitOrderContext,
    dismissOrderSettings,
    draftFulfillmentType,
    draftTimeValue,
    deliveryUnavailable,
    fulfillmentType,
    hasSelectedDeliveryAddress,
    orderSettingsOpen,
    scheduledFor,
    showDeliveryAddressError,
    syncDraftOrderSettings,
  ]);

  const displayedFulfillmentType = fulfillmentType;
  const actionLabel = orderSettingsOpen ? "Done" : "Change";

  return (
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
            disabled={!menu}
          >
            {actionLabel}
          </button>
        </div>
      </div>

      {orderSettingsOpen && menu && (
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
  );
}
