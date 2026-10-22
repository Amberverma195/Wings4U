import { registerDecorator } from "class-validator";

/** Shapes include wing slots, child salad modifiers, lunch add-ons and ingredient lists. */
export function isBoundedCustomization(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > 4096 || entry.depth > 8) return false;
    const current = entry.value;
    if (typeof current === "string" && current.length > 2000) return false;
    if (Array.isArray(current) && current.length > 128) return false;
    if (current && typeof current === "object") {
      const entries = Object.entries(current);
      if (!Array.isArray(current) && entries.length > 64) return false;
      for (const [key, child] of entries) {
        if (key.length > 128) return false;
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") <= 32768;
}

export function BoundedCustomization(): PropertyDecorator {
  return (target, propertyName) => registerDecorator({
    name: "boundedCustomization", target: target.constructor, propertyName: String(propertyName),
    validator: { validate: isBoundedCustomization,
      defaultMessage: () => "Customization exceeds the supported size or nesting limits" },
  });
}
