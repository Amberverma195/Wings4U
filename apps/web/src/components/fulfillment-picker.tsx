import { handleRadioGroupKeyDown } from "@/lib/radio-group";

export function FulfillmentPicker({ value, onChange, deliveryUnavailable }: {
  value: "PICKUP" | "DELIVERY";
  onChange: (value: "PICKUP" | "DELIVERY") => void;
  deliveryUnavailable: boolean;
}) {
  const tabStop = deliveryUnavailable ? "PICKUP" : value;
  return (
    <div className="wk-order-settings-panel-toggle" role="radiogroup"
      aria-label="Edit fulfillment type" onKeyDown={handleRadioGroupKeyDown}>
      {(["PICKUP", "DELIVERY"] as const).map(option => (
        <button key={option} type="button" className="wk-order-fulfillment-btn"
          role="radio" aria-checked={value === option} tabIndex={tabStop === option ? 0 : -1}
          data-active={value === option ? "true" : "false"}
          data-disabled={option === "DELIVERY" && deliveryUnavailable ? "true" : "false"}
          disabled={option === "DELIVERY" && deliveryUnavailable}
          onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
