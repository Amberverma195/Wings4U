UPDATE "modifier_options"
SET "name" = 'Add Jalapenos'
WHERE "name" IN ('Add Jalapeños', 'Add JalapeÃ±os');

UPDATE "modifier_options"
SET "name" = 'Extra Jalapeno Popper',
    "addon_match_normalized" = 'jalapeno popper'
WHERE "name" IN ('Extra Jalapeño Popper', 'Extra JalapeÃ±o Popper');

UPDATE "removable_ingredients"
SET "name" = 'Jalapeno Popper'
WHERE "name" IN ('Jalapeño Popper', 'JalapeÃ±o Popper');

UPDATE "menu_items"
SET "name" = 'Jalapeno Poppers (6pc.)'
WHERE "slug" = 'jalapeno-poppers'
  AND "name" IN ('Jalapeño Poppers (6pc.)', 'JalapeÃ±o Poppers (6pc.)');

UPDATE "menu_items"
SET "description" = 'Lettuce, red onion, tomato, cauliflower bites, jalapeno popper, cheese blend, roasted garlic, tzatziki'
WHERE "slug" = 'veggie-wrap';
