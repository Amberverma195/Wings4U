export type CartItemIssue = { code: string; message: string; ids: string[]; indices: number[] };

/** Only structured server validation identifies an item; never guess from message text. */
export function getCartItemIssue(value: unknown): CartItemIssue | null {
  if (!value || typeof value !== 'object') return null;
  const body = (value as { body?: unknown }).body ?? value;
  if (!body || typeof body !== 'object') return null;
  const row = (body as { errors?: unknown[] }).errors?.[0] ?? body;
  if (!row || typeof row !== 'object') return null;
  const candidate = row as { code?: string; message?: string; detail?: { affected_item_ids?: unknown; affected_item_indices?: unknown } };
  if (!['CART_ITEM_CONFIGURATION_INVALID', 'CART_ITEM_UNAVAILABLE'].includes(candidate.code ?? '')) return null;
  return {
    code: candidate.code!, message: typeof candidate.message === 'string' ? candidate.message : 'Please review this item before checkout.',
    ids: Array.isArray(candidate.detail?.affected_item_ids) ? candidate.detail.affected_item_ids.filter((id): id is string => typeof id === 'string') : [],
    indices: Array.isArray(candidate.detail?.affected_item_indices) ? candidate.detail.affected_item_indices.filter((n): n is number => Number.isSafeInteger(n) && n >= 0) : [],
  };
}

export function issueAffectsLine(issue: CartItemIssue | null | undefined, id: string, index: number): boolean {
  return Boolean(issue && (issue.indices.length ? issue.indices.includes(index) : issue.ids.includes(id)));
}

export function savedSelectionReview(
  line: { modifier_selections: Array<{ modifier_option_id?: string; option_name?: string }>; builder_payload?: { weight_lb?: number } | unknown } | null | undefined,
  option: { weight_lb: number; modifier_groups: Array<{ options: Array<{ id: string }> }> } | null | undefined,
  childIds: string[] = [],
): string | null {
  if (!line || !option) return null;
  const ids = new Set([...option.modifier_groups.flatMap(group => group.options.map(row => row.id)), ...childIds]);
  const removed = line.modifier_selections.filter(row => row.modifier_option_id && !ids.has(row.modifier_option_id));
  if (removed.length) return 'Menu options have changed. Review your selections. Saving will remove unavailable options: ' + removed.map(row => row.option_name || 'a selected option').join(', ') + '. Your cart stays unchanged until you save.';
  const payload = line.builder_payload as { weight_lb?: unknown } | undefined;
  if (payload?.weight_lb !== option.weight_lb) return 'Portion information has changed. Please review this item before saving. Your cart stays unchanged until you save.';
  return null;
}
