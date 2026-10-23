"use client";

import { PICKUP_ETA_RANGE } from "@/lib/pickup-eta";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { apiJson } from "@/lib/api";
import { useModalDialog } from "@/lib/use-modal-dialog";
import {
  DELIVERY_ADDRESS_SAVED_EVENT,
  FIXED_DELIVERY_CITY,
  loadDeliveryAddressDraft,
  loadSavedAddresses,
  normalizeDeliveryPostalCode,
  replaceSavedAddressById,
  replaceSavedAddressByIdSync,
  saveDeliveryAddressDraft,
  upsertSavedAddressFromDraft,
  upsertSavedAddressFromDraftSync,
} from "@/lib/delivery-address";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import {
  buildScheduleDateOptions,
  buildScheduleTimeOptions,
  DEFAULT_SCHEDULING_CONFIG,
  getDateKey,
  getInitialTimeValue,
  getSelectedDateKey,
  normalizeSchedulingConfig,
  type SchedulingHours,
} from "@/lib/order-scheduling";
import {
  getDeliveryUnavailableMessage,
} from "@/lib/delivery-restrictions";
import type { FulfillmentType, MenuResponse } from "@/lib/types";

type ModalStep = "method" | "schedule" | "address";

export type OrderMethodSelection = {
  fulfillment_type: FulfillmentType;
  scheduled_for: string | null;
};

const EMPTY_DELIVERY_ADDRESS = {
  line1: "",
  city: FIXED_DELIVERY_CITY,
  postalCode: "",
};

function OrderMetaIcon({ kind }: { kind: "date" | "time" }) {
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

export function OrderMethodModal({
  open,
  defaultMethod = "DELIVERY",
  initialStep: initialStepProp,
  addressOnly = false,
  addressContext = "order",
  editingSavedAddressId = null,
  initialScheduledFor = null,
  onClose,
  onContinue,
  refresh,
  clear,
}: {
  open: boolean;
  defaultMethod?: FulfillmentType;
  initialStep?: ModalStep;
  addressOnly?: boolean;
  addressContext?: "account" | "order";
  editingSavedAddressId?: string | null;
  initialScheduledFor?: string | null;
  onClose: () => void;
  onContinue: (selection: OrderMethodSelection) => void;
  refresh?: () => Promise<void | boolean>;
  clear?: () => void;
}) {
  const resolvedInitialStep: ModalStep =
    initialStepProp ?? (addressOnly ? "address" : "method");

  const [method, setMethod] = useState<FulfillmentType>(defaultMethod);
  const [step, setStep] = useState<ModalStep>(resolvedInitialStep);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressPostal, setAddressPostal] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const savingAddressRef = useRef(false);
  const addressEditorGeneration = useRef(0);
  /** Bumps on each failed submit so the error line can replay its enter animation. */
  const [addressErrorAnimKey, setAddressErrorAnimKey] = useState(0);
  const [scheduleDateKey, setScheduleDateKey] = useState(() =>
    getSelectedDateKey(initialScheduledFor),
  );
  const [scheduleTimeValue, setScheduleTimeValue] = useState(
    initialScheduledFor ?? "ASAP",
  );
  const [schedulingConfig, setSchedulingConfig] = useState(DEFAULT_SCHEDULING_CONFIG);
  const [pickupScheduleRevision, setPickupScheduleRevision] = useState(0);
  const [schedulingLeadMinutes, setSchedulingLeadMinutes] = useState<number | undefined>(undefined);
  const [schedulingHours, setSchedulingHours] = useState<SchedulingHours | undefined>(
    undefined,
  );
  const [scheduleTimezone, setScheduleTimezone] = useState<string | undefined>(undefined);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useModalDialog({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    active: open,
  });

  const [deliveryUnavailableMessage, setDeliveryUnavailableMessage] = useState<string | null>(null);
  
  const cardRef = useRef<HTMLDivElement | null>(null);

  const updateRim = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--rim-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--rim-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  const clearRim = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

  useEffect(() => {
    addressEditorGeneration.current += 1;
    savingAddressRef.current = false;
    setSavingAddress(false);
  }, [open, editingSavedAddressId, addressContext, addressOnly]);

  useEffect(() => {
    if (!open) return;

    let initialAddress: { line1: string; postalCode: string } | null = null;
    
    if (editingSavedAddressId) {
      const allSaved = loadSavedAddresses();
      const match = allSaved.find(a => a.id === editingSavedAddressId);
      if (match) {
        initialAddress = match;
      }
    } else if (!addressOnly) {
      initialAddress = loadDeliveryAddressDraft();
    }

    const nextStep = initialStepProp ?? (addressOnly ? "address" : "method");

    setMethod(nextStep === "address" ? "DELIVERY" : defaultMethod);
    setStep(nextStep);
    setAddressError(null);
    setSaveToAccount(false);
    setAddressErrorAnimKey(0);
    setAddressLine1(initialAddress?.line1 ?? EMPTY_DELIVERY_ADDRESS.line1);
    setAddressPostal(initialAddress?.postalCode ?? EMPTY_DELIVERY_ADDRESS.postalCode);
    setScheduleDateKey(getSelectedDateKey(initialScheduledFor));
    setScheduleTimeValue(initialScheduledFor ?? "ASAP");
    setDeliveryUnavailableMessage(null);
  }, [open, defaultMethod, initialStepProp, addressOnly, initialScheduledFor, editingSavedAddressId, addressContext]);

  useEffect(() => {
    if (!open || addressOnly) return;

    let cancelled = false;

    async function loadSchedulingContext() {
      setScheduleLoading(true);
      setSchedulingLeadMinutes(undefined);
      setScheduleNotice(null);

      try {
        const query = new URLSearchParams({
          location_id: DEFAULT_LOCATION_ID,
          fulfillment_type: defaultMethod,
        });
        const response = await apiJson<MenuResponse>(
          `/api/catalog/menu?${query.toString()}`,
          { locationId: DEFAULT_LOCATION_ID },
        );

        if (cancelled || !response.data) return;

        setSchedulingConfig(
          normalizeSchedulingConfig({
            pickup: {
              minMinutes: response.data.location.pickup_min_minutes,
              maxMinutes: response.data.location.pickup_max_minutes,
            },
            delivery: {
              minMinutes: response.data.location.delivery_min_minutes,
              maxMinutes: response.data.location.delivery_max_minutes,
            },
          }),
        );
        setSchedulingLeadMinutes(response.data.location.estimated_prep_minutes);
        setSchedulingHours({
          pickup: response.data.location.pickup_hours,
          delivery: response.data.location.delivery_hours,
          store: response.data.location.store_hours ?? [],
        });
        setScheduleTimezone(response.data.location.timezone);
        const nextDeliveryUnavailableMessage =
          getDeliveryUnavailableMessage(response.data);
        setDeliveryUnavailableMessage(nextDeliveryUnavailableMessage);
        if (nextDeliveryUnavailableMessage) {
          setMethod("PICKUP");
        }
      } catch {
        if (!cancelled) {
          setScheduleNotice(
            "Using fallback scheduling windows until live store timings load.",
          );
        }
      } finally {
        if (!cancelled) {
          setScheduleLoading(false);
        }
      }
    }

    void loadSchedulingContext();
    return () => {
      cancelled = true;
    };
  }, [addressOnly, defaultMethod, open]);



  const totalSteps = addressOnly ? 1 : method === "DELIVERY" ? 3 : 2;
  const currentStepNumber = addressOnly
    ? 1
    : step === "method"
      ? 1
      : step === "schedule"
        ? 2
        : totalSteps;
  const showStepLabel = addressOnly || step !== "method" || method === "DELIVERY";
  const addressEditMode = Boolean(editingSavedAddressId) && step === "address";
  const explicitSave = addressContext === "account" || addressEditMode || saveToAccount;
  const stepLabel = addressEditMode
    ? "EDIT ADDRESS"
    : `STEP ${currentStepNumber} OF ${totalSteps}`;
  const title =
    step === "address"
      ? addressEditMode
        ? "UPDATE DELIVERY ADDRESS"
        : addressOnly ? "ADD DELIVERY ADDRESS" : "WHERE SHOULD WE DELIVER?"
      : step === "schedule"
        ? "WHEN SHOULD WE HAVE IT READY?"
        : "HOW DO YOU WANT YOUR WINGS?";
  const subtitle: string | null =
    addressEditMode
      ? null
      : step === "address"
        ? null
        : step === "schedule"
          ? null
          : "Choose your order type to continue";

  const scheduleDateOptions = useMemo(
    () =>
      buildScheduleDateOptions(method, schedulingHours, scheduleTimezone),
    [method, schedulingHours, scheduleTimezone, pickupScheduleRevision],
  );

  const scheduleTimeOptions = useMemo(
    () =>
      buildScheduleTimeOptions({
        fulfillmentType: method,
        selectedDateKey: scheduleDateKey,
        config: schedulingConfig,
        pickupLeadMinutes: schedulingLeadMinutes,
        hours: schedulingHours,
        timezone: scheduleTimezone,
      }),
    [method, scheduleDateKey, schedulingConfig, schedulingHours, scheduleTimezone, schedulingLeadMinutes, pickupScheduleRevision],
  );

  useEffect(() => {
    if (!open || addressOnly) return;
    if (!scheduleDateOptions.some((option) => option.value === scheduleDateKey)) {
      setScheduleDateKey(scheduleDateOptions[0]?.value ?? getDateKey(new Date()));
    }
  }, [addressOnly, open, scheduleDateKey, scheduleDateOptions]);

  useEffect(() => {
    if (!open || addressOnly) return;

    const nextTimeValue = getInitialTimeValue(
      scheduleTimeValue === "ASAP" ? null : scheduleTimeValue,
      scheduleTimeOptions,
    );

    if (nextTimeValue !== scheduleTimeValue) {
      setScheduleTimeValue(nextTimeValue);
    }
  }, [addressOnly, open, scheduleTimeOptions, scheduleTimeValue]);

  const committedScheduledFor = scheduleTimeValue === "ASAP" ? null : scheduleTimeValue;

  const continueLabel = useMemo(() => {
    if (step === "address") {
      if (addressEditMode) return "SAVE CHANGES";
      if (addressContext === "account") return "ADD ADDRESS";
      if (addressOnly) return saveToAccount ? "SAVE & USE ADDRESS" : "USE ADDRESS";
      return "CONTINUE TO MENU";
    }
    if (step === "schedule") {
      return method === "DELIVERY"
        ? "CONTINUE TO ADDRESS ->"
        : "CONTINUE TO MENU ->";
    }
    return "CONTINUE TO SCHEDULE ->";
  }, [addressEditMode, addressContext, addressOnly, saveToAccount, method, step]);

  const continueDisabled = savingAddress || (
    step === "schedule" &&
    (scheduleLoading ||
      scheduleDateOptions.length === 0 ||
      scheduleTimeOptions.length === 0));

  if (!open) return null;

  async function handleContinue() {
    if (savingAddressRef.current) return;
    if (step === "method") {
      setAddressError(null);
      setStep("schedule");
      return;
    }

    if (step === "schedule") {
      if (continueDisabled) return;
      if (method === "PICKUP") {
        const current = buildScheduleTimeOptions({ fulfillmentType: "PICKUP", selectedDateKey: scheduleDateKey,
          config: schedulingConfig, hours: schedulingHours, timezone: scheduleTimezone, pickupLeadMinutes: schedulingLeadMinutes });
        if (!current.some(option => option.value === scheduleTimeValue)) {
          setPickupScheduleRevision(value => value + 1);
          setScheduleNotice("Pickup availability changed. Please choose an available time.");
          setScheduleTimeValue(getInitialTimeValue(null, current));
          return;
        }
      }
      if (method === "DELIVERY") {
        setAddressError(null);
        setStep("address");
        return;
      }

      onContinue({
        fulfillment_type: "PICKUP",
        scheduled_for: committedScheduledFor,
      });
      return;
    }

    const normalizedAddress = {
      line1: addressLine1.trim(),
      city: FIXED_DELIVERY_CITY,
      postalCode: normalizeDeliveryPostalCode(addressPostal),
    };

    if (!normalizedAddress.line1 || !normalizedAddress.postalCode) {
      setAddressError("Street address and postal code are required.");
      setAddressErrorAnimKey((k) => k + 1);
      return;
    }

    if (editingSavedAddressId && !loadSavedAddresses().some(address => address.id === editingSavedAddressId)) {
      setAddressError("Address not found. Please reopen your address book.");
      return;
    }
    savingAddressRef.current = true;
    const editorGeneration = addressEditorGeneration.current;
    setSavingAddress(true);
    setAddressError(null);
    try {
      let savedToAccount = false;
      if (editingSavedAddressId) {
        if (refresh && clear) {
          savedToAccount = await replaceSavedAddressByIdSync(editingSavedAddressId, normalizedAddress, refresh, clear);
        } else {
          savedToAccount = await replaceSavedAddressById(editingSavedAddressId, normalizedAddress);
        }
      } else if (explicitSave) {
        // Set the draft before recording guest consent, since draft changes revoke old consent.
        if (addressContext === "order") saveDeliveryAddressDraft(normalizedAddress);
        if (refresh && clear) {
          savedToAccount = await upsertSavedAddressFromDraftSync(normalizedAddress, refresh, clear);
        } else {
          savedToAccount = await upsertSavedAddressFromDraft(normalizedAddress);
        }
      }
      if (editorGeneration !== addressEditorGeneration.current) return;
      if (addressContext === "order" && (editingSavedAddressId || !explicitSave)) {
        saveDeliveryAddressDraft(normalizedAddress, Boolean(editingSavedAddressId) && !savedToAccount);
      }
      if (savedToAccount && typeof window !== "undefined") {
        window.dispatchEvent(new Event(DELIVERY_ADDRESS_SAVED_EVENT));
      }
      onContinue({
        fulfillment_type: "DELIVERY",
        scheduled_for: committedScheduledFor,
      });
    } catch (error) {
      if (editorGeneration !== addressEditorGeneration.current) return;
      setAddressError(error instanceof Error ? error.message : "Unable to save this address. Please try again.");
      setAddressErrorAnimKey(key => key + 1);
    } finally {
      if (editorGeneration === addressEditorGeneration.current) {
        savingAddressRef.current = false;
        setSavingAddress(false);
      }
    }
  }

  return (
    <div className="wk-method-overlay" onMouseDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="wk-method-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div 
          className="wk-method-card-inner"
          ref={cardRef}
          onMouseMove={updateRim}
          onMouseEnter={updateRim}
          onMouseLeave={clearRim}
        >
          <div className="wk-auth-card-glow" aria-hidden />
          <div className="wk-auth-card-rim" aria-hidden />
          
          <button
            ref={closeButtonRef}
            type="button"
            className="wk-method-close"
            onClick={onClose}
            aria-label="Close"
          >
            {"\u00D7"}
          </button>

          <div className="wk-method-header">
            {showStepLabel ? <div className="wk-method-step">{stepLabel}</div> : null}
            <h2 className="wk-method-title">{title}</h2>
            {subtitle ? (
              <p
                className={
                  step === "method"
                    ? "wk-method-sub wk-method-sub--accent"
                    : "wk-method-sub"
                }
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          {step === "method" ? (
            <div className="wk-method-options" role="radiogroup" aria-label="Order fulfillment method">
              <button
                type="button"
                className="wk-method-option"
                role="radio"
                aria-checked={method === "PICKUP"}
                aria-label={`Pickup, free, ${PICKUP_ETA_RANGE} minutes`}
                data-selected={method === "PICKUP" ? "true" : "false"}
                onClick={() => setMethod("PICKUP")}
              >
                <div className="wk-method-option-top">
                  <div className="wk-method-icon" aria-hidden="true">
                    {"\u{1F6CD}\uFE0F"}
                  </div>
                  {method === "PICKUP" ? (
                    <span className="wk-method-check">{"\u2713"}</span>
                  ) : null}
                </div>
                <div className="wk-method-tags">
                  <span className="wk-method-tag">FREE</span>
                  <span className="wk-method-tag">{PICKUP_ETA_RANGE} MIN</span>
                </div>
                <div className="wk-method-option-name">PICKUP</div>
                <div className="wk-method-option-desc">
                  Grab it fresh from our store. Zero fees, zero waiting.
                </div>
              </button>

              <button
                type="button"
                className="wk-method-option"
                role="radio"
                aria-checked={method === "DELIVERY"}
                aria-label={
                  deliveryUnavailableMessage
                    ? `Delivery, currently unavailable: ${deliveryUnavailableMessage}`
                    : "Delivery, starting at $5, approximately 30 minutes"
                }
                data-selected={method === "DELIVERY" ? "true" : "false"}
                data-disabled={deliveryUnavailableMessage ? "true" : "false"}
                onClick={() => {
                  if (deliveryUnavailableMessage) return;
                  setMethod("DELIVERY");
                }}
                disabled={Boolean(deliveryUnavailableMessage)}
              >
                <div className="wk-method-option-top">
                  <div className="wk-method-icon" aria-hidden="true">
                    {"\u{1F6F5}"}
                  </div>
                  {method === "DELIVERY" ? (
                    <span className="wk-method-check">{"\u2713"}</span>
                  ) : null}
                </div>
                <div className="wk-method-tags">
                  <span className="wk-method-tag">FROM $5</span>
                  <span className="wk-method-tag">~30 MIN</span>
                </div>
                <div className="wk-method-option-name">DELIVERY</div>
                <div className="wk-method-option-desc">
                  {deliveryUnavailableMessage
                    ? deliveryUnavailableMessage
                    : "We bring the heat straight to your door. Fast and fresh."}
                </div>
              </button>
            </div>
          ) : step === "schedule" ? (
            <div className="wk-method-address-panel">
              <div className="wk-order-settings-grid">
                <div className="wk-order-settings-field">
                  <span className="wk-order-settings-field-label">Date</span>
                  <label className="wk-order-settings-select-wrap">
                    <span className="wk-order-settings-select-icon" aria-hidden="true">
                      <OrderMetaIcon kind="date" />
                    </span>
                    <select
                      className="wk-order-settings-select"
                      value={scheduleDateKey}
                      onChange={(event) => setScheduleDateKey(event.target.value)}
                      disabled={scheduleLoading || scheduleDateOptions.length === 0}
                    >
                      {scheduleDateOptions.map((option) => (
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
                      value={scheduleTimeValue}
                      onChange={(event) => setScheduleTimeValue(event.target.value)}
                      disabled={scheduleLoading || scheduleTimeOptions.length === 0}
                    >
                      {scheduleTimeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {scheduleLoading ? (
                <p className="wk-method-form-error">Loading live scheduling windows...</p>
              ) : null}
              {!scheduleLoading && scheduleNotice ? (
                <p className="wk-method-form-error">{scheduleNotice}</p>
              ) : null}

              <button
                type="button"
                className="wk-method-back"
                onClick={() => setStep("method")}
              >
                Back
              </button>
            </div>
          ) : (
            <div className="wk-method-address-panel">
              <div className="wk-method-address-grid">
                <label className="wk-method-address-field">
                  <span className="wk-method-address-label">Street address</span>
                  <input
                    className="wk-method-address-input"
                    value={addressLine1}
                    onChange={(event) => {
                      setAddressLine1(event.target.value);
                      if (addressError) setAddressError(null);
                    }}
                    placeholder="123 Dundas St"
                    autoComplete="address-line1"
                  />
                </label>

                <div className="wk-method-address-row">
                  <label className="wk-method-address-field">
                    <span className="wk-method-address-label">City</span>
                    <input
                      className="wk-method-address-input"
                      value={FIXED_DELIVERY_CITY}
                      readOnly
                      aria-readonly="true"
                      tabIndex={-1}
                    />
                  </label>

                  <label className="wk-method-address-field">
                    <span className="wk-method-address-label">Postal code</span>
                    <input
                      className="wk-method-address-input"
                      value={addressPostal}
                      onChange={(event) => {
                        setAddressPostal(normalizeDeliveryPostalCode(event.target.value));
                        if (addressError) setAddressError(null);
                      }}
                      placeholder="N6A 1A1"
                      autoComplete="postal-code"
                    />
                  </label>
                </div>
              </div>

              <p className="wk-method-privacy-notice">
                To calculate delivery fees and check delivery availability, we share your delivery address with Google Maps. We do not send your name, phone number, email, or payment information.{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wk-method-privacy-link"
                >
                  Privacy Policy
                </a>
              </p>

              {addressContext === "order" && !editingSavedAddressId ? (
                <div className="wk-address-save-preference">
                  <label className="wk-address-save-label">
                    <input type="checkbox" checked={saveToAccount} disabled={savingAddress}
                      onChange={event => setSaveToAccount(event.target.checked)} />
                    <span>Save this address to my account for future orders</span>
                  </label>
                  <p>We'll use this address for your delivery even if you don't save it. You can manage saved addresses anytime in Profile {"\u2192"} Addresses.</p>
                </div>
              ) : null}

              {addressError ? (
                <p
                  key={addressErrorAnimKey}
                  className="wk-method-form-error wk-method-form-error--pulse"
                  role="alert"
                >
                  {addressError}
                </p>
              ) : null}

              <button
                type="button"
                className="wk-method-back"
                onClick={() => {
                  if (addressOnly) {
                    onClose();
                    return;
                  }
                  setAddressError(null);
                  setStep("schedule");
                }}
              >
                {addressOnly ? "Cancel" : "Back"}
              </button>
            </div>
          )}

          <button
            type="button"
            className="wk-method-continue"
            onClick={handleContinue}
            disabled={continueDisabled}
          >
            <span className="wk-method-continue-label">{savingAddress ? "SAVING ADDRESS..." : continueLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
