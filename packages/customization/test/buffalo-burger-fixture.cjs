// Historical, checked-in evidence only. Approval variants never modify inventory.
const snapshot = require('../../../Docs/audits/non-wing-catalog-readonly.json');
function buffaloBurger(approved = false) {
  const item = structuredClone(snapshot.catalog.find(row => row.slug === 'buffalo-chicken-burger'));
  Object.assign(item, { image_url: null, is_available: true, stock_status: 'NORMAL',
    allowed_fulfillment_type: 'BOTH', requires_special_instructions: false });
  if (approved) item.modifier_groups[0].options.find(row => row.name === 'Add Bacon').addon_match_normalized = '__always__';
  return item;
}
module.exports = { buffaloBurger };
