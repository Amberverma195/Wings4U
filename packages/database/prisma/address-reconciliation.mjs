/** Read-only planning. No customer records are changed or removed. */
export function buildAddressReconciliationPlan(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.user_id, row.identity]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => {
    const members = [...group].sort((a,b) => Number(b.is_default)-Number(a.is_default) ||
      Number(Boolean(b.label?.trim()))-Number(Boolean(a.label?.trim())) ||
      String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
    const labels = [...new Set(members.map(row => row.label?.trim()).filter(Boolean))];
    return { user_id: members[0].user_id, identity: members[0].identity,
      recommended_keep_id: members[0].id, duplicate_ids: members.slice(1).map(row => row.id),
      recommended_label: members[0].label?.trim() || labels[0] || null,
      requires_label_review: labels.length > 1, labels, members };
  }).sort((a,b) => a.user_id.localeCompare(b.user_id) || a.identity.localeCompare(b.identity));
}

// Inline identity permits preview before the migration has been installed.
export const addressPreviewQuery = `SELECT id, user_id, line1, city, postal_code, label, is_default,
  created_at::text, updated_at::text,
  jsonb_build_array(
    lower(trim(regexp_replace(normalize(line1, NFKC), '[[:space:]]+', ' ', 'g'))),
    lower(trim(regexp_replace(normalize(city, NFKC), '[[:space:]]+', ' ', 'g'))),
    lower(regexp_replace(normalize(postal_code, NFKC), '[[:space:]]+', '', 'g'))
  )::text AS identity FROM customer_addresses`;
