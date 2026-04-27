-- Fix UTF-8 mojibake: "ñ" was stored as the two characters U+00C3 + U+00B1 ("Ã±") instead of U+00F1 ("ñ").
UPDATE modifier_options
SET name = 'Add Jalapeños'
WHERE name = 'Add JalapeÃ±os';

-- Display name consistency (ASCII "Jalapeno" -> proper spelling).
UPDATE menu_items
SET name = REPLACE(name, 'Jalapeno Poppers', 'Jalapeño Poppers')
WHERE name LIKE '%Jalapeno Poppers%';
