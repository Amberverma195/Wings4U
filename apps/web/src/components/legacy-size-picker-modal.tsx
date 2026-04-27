"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/lib/cart";
import { cents } from "@/lib/format";
import type { LegacySizePickerGroup } from "@/Wings4u/menu-display";
import { BuilderShell } from "./builder-shared";

type Props = {
  group: LegacySizePickerGroup;
  onClose: () => void;
};

export function LegacySizePickerModal({ group, onClose }: Props) {
  const { addItem } = useCart();
  const [selectedItemId, setSelectedItemId] = useState(group.options[0]?.item.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");

  const selectedOption = useMemo(
    () => group.options.find((option) => option.item.id === selectedItemId) ?? null,
    [group.options, selectedItemId],
  );

  function handleAdd() {
    if (!selectedOption) return;

    addItem({
      menu_item_id: selectedOption.item.id,
      menu_item_slug: selectedOption.item.slug,
      name: selectedOption.item.name,
      image_url: selectedOption.item.image_url,
      base_price_cents: selectedOption.item.base_price_cents,
      quantity,
      modifier_selections: [],
      special_instructions: instructions.trim(),
    });

    onClose();
  }

  return (
    <BuilderShell
      title={group.displayName}
      description={group.displayDescription ?? "Choose a size before adding this item to cart."}
      onClose={onClose}
      closeAriaLabel={`Close ${group.displayName} size picker`}
      quantity={quantity}
      onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
      onIncrease={() => setQuantity((value) => value + 1)}
      quantityDisabled={!selectedOption}
      totalCents={(selectedOption?.item.base_price_cents ?? 0) * quantity}
      submitLabel="Add to cart"
      submitDisabled={!selectedOption}
      onSubmit={handleAdd}
    >
      <section className="builder-step-card">
        <div className="builder-step-card-head">
          <h3>Choose size</h3>
          <p>Select the size variant you want before adding this item to cart.</p>
        </div>
        <div className="builder-option-pills">
          {group.options.map((option) => {
            const active = option.item.id === selectedItemId;
            return (
              <button
                key={option.item.id}
                type="button"
                className={`builder-option-pill${active ? " builder-option-pill-active" : ""}`}
                onClick={() => setSelectedItemId(option.item.id)}
              >
                {option.label}
                <span
                  className="price-text"
                  style={{ marginLeft: "0.4rem", fontSize: "0.84em", opacity: 0.92 }}
                >
                  {cents(option.item.base_price_cents)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="builder-step-card">
        <div className="builder-step-card-head">
          <h3>Special instructions</h3>
          <p>Notes for the kitchen.</p>
        </div>
        <textarea
          className="builder-textarea"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="e.g. extra crispy"
          rows={3}
        />
      </section>
    </BuilderShell>
  );
}
