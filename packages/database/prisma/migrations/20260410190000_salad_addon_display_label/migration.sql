-- Salad add-on section title: align stored display_label with current menu copy.
UPDATE modifier_groups
SET display_label = 'Additional ingredients'
WHERE context_key = 'addon'
  AND display_label = 'Salad extras';
