"use client";

import { ComboBox, Input, Label, ListBox } from "@heroui/react";

const OPTIONS = [
  { id: "__none__", value: "", textValue: "None", label: "None" },
  { id: "HAND_TO_ME", value: "HAND_TO_ME", textValue: "Hand to me", label: "Hand to me" },
  { id: "LEAVE_AT_DOOR", value: "LEAVE_AT_DOOR", textValue: "Leave at door", label: "Leave at door" },
  { id: "CALL_ON_ARRIVAL", value: "CALL_ON_ARRIVAL", textValue: "Call on arrival", label: "Call on arrival" },
  { id: "TEXT_ON_ARRIVAL", value: "TEXT_ON_ARRIVAL", textValue: "Text on arrival", label: "Text on arrival" },
] as const;

type Props = {
  value: string;
  onChange: (next: string) => void;
};

export function ContactlessPreferenceCombo({ value, onChange }: Props) {
  const selectedKey = value === "" ? "__none__" : value;

  return (
    <ComboBox
      className="checkout-contactless-combo w-full max-w-full"
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        if (key == null || key === "__none__") {
          onChange("");
          return;
        }
        onChange(String(key));
      }}
    >
      <Label className="checkout-contactless-combo-label">Contactless preference</Label>
      <ComboBox.InputGroup>
        <Input className="checkout-contactless-combo-input" placeholder="Search or choose…" />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="checkout-contactless-combo-popover">
        <ListBox>
          {OPTIONS.map((opt) => (
            <ListBox.Item key={opt.id} id={opt.id} textValue={opt.textValue}>
              {opt.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
