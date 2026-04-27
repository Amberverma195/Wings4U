const MENU_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Jalape(?:\u00f1|\u00c3\u00b1)os/g, "Jalapenos"],
  [/Jalape(?:\u00f1|\u00c3\u00b1)o/g, "Jalapeno"],
  [/jalape(?:\u00f1|\u00c3\u00b1)os/g, "jalapenos"],
  [/jalape(?:\u00f1|\u00c3\u00b1)o/g, "jalapeno"],
];

export function normalizeIngredientDisplayText(value: string): string {
  let normalized = value;

  for (const [pattern, replacement] of MENU_TEXT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}
