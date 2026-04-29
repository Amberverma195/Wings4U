Salads on menu + Wings-4-U dynamic salad customization

Current state (baseline)





No salads category in [packages/database/prisma/seed.ts](packages/database/prisma/seed.ts) — categories end at Dips (~line 300–316); salads are not first-class menu items.



Wings-4-U Special ([seed.ts](packages/database/prisma/seed.ts) ~1237–1265) uses a shared saladTypeGroup with only three options (Garden / Caesar / Greek), plus a single static removableIngredients + addonOptions list on the special — it cannot show “only ingredients for the salad you picked.”



Top nav ([apps/web/src/Wings4u/components/navbar.tsx](apps/web/src/Wings4u/components/navbar.tsx)) is logo + Login + Cart only — no link to /menu or salads.



Wings builder ([apps/web/src/components/wings-builder.tsx](apps/web/src/components/wings-builder.tsx)) reads item.removable_ingredients from the parent MenuItem (Wings-4-U line). There is no linked_menu_item_id on modifier_options in Prisma today (only linked_flavour_id for wing flavours).

Target UX (from your reference)







Salad



Sizes / price



Notes





Caesar



Small $6.99 / Large $10.99



Romaine, bacon, croutons, parm; Caesar dressing





Garden



Small $6.99 / Large $10.99



Iceberg, onion, tomato, cucumber, carrots, cheese; ranch





Greek



Small $6.99 / Large $10.99



Iceberg, onion, tomato, cucumber, olives, feta; Greek dressing





Horiatiki (village)



Small $8.99 / Large $12.99



Pepper, onion, tomato, cucumber, olives, feta; olive oil





Buffalo Chicken



$15.99 (single line)



Lettuce, cucumber, cheese blend, onion, tomato, croutons, breaded chicken; ranch on side

Add-on (all sized salads): “Add fresh hand breaded chicken” — +$2.99 with small, +$3.99 with large (enforce: only the matching option is valid for the chosen size).



1. Catalog / seed (source of truth)

Add category e.g. salads (“Salads & Greens” or “Salads”) in categoryDefs with a sensible sort_order (e.g. after wraps or before specials — product decision).

Per salad row, use the existing createItem pattern with:





modifiers: a size group (Small / Large with priceDeltaCents matching the reference) — except Buffalo Chicken Salad: either one SKU at 1599 or a single-size pseudo group if you want the builder to stay consistent.



removableIngredients: parsed from the menu copy (fix typos in DB display: “parm cheese”, “cheese blend”, etc.).



addonOptions: salad-specific extras (extra dressing, extra protein, etc.) via existing createAddonGroup + context_key: "addon".



Chicken add-on: implement as one modifier group (e.g. “Add breaded chicken”) with two modifier_option rows: Small +$2.99 (299), Large +$3.99 (399). Client validation in [ItemCustomizationOverlay](apps/web/src/components/item-customization-overlay.tsx): when size is Small, only allow/clear the small chicken option (same pattern you use elsewhere for dependent modifiers).

Expand saladTypeGroup used by Wings-4-U (same file, ~526–541): add options for Horiatiki and Buffalo Chicken Salad (names must match what you’ll map in the builder, or use stable slugs if you add a mapping table).

Re-seed / migration note: Your seed currently skips when LON01 exists — document that a fresh seed or a dedicated “menu sync” is required for production DBs, or adjust seed idempotency in a follow-up.



2. Navigation (“salads in menubar”)





Global bar ([navbar.tsx](apps/web/src/Wings4u/components/navbar.tsx)): add at least “Menu” → /menu. Optionally add “Salads” that deep-links into the menu:





Preferred: support ?cat=salads (or ?section=salads) on [menu-page.tsx](apps/web/src/Wings4u/components/menu-page.tsx): on load, resolve category by slug salads and call existing scrollToCategory(category.id) + set active tab. Hash #cat-<uuid> is fragile without knowing UUID client-side until menu loads.



Menu page sticky categories: once the salads category exists in the API, it will appear in the horizontal category strip automatically (same as other categories).



3. Wings-4-U Special: salad type → correct ingredients + add-ons

Problem: Removals and add-ons are validated in the API against menu_item_id of the line (the special). Ingredient IDs for “Caesar” vs “Greek” are different rows — you cannot validate Caesar-only removals against a parent item that only has a union list without ambiguity.

Recommended approach (no Prisma migration):





Extend [WingBuilderPayload](apps/web/src/lib/types.ts) with an optional block, e.g. salad_customization?: { salad_menu_item_id: string; removed_ingredients: RemovedIngredientSelection[]; modifier_selections for salad-only picks } (exact shape to mirror cart modifier lines you already use, but scoped to the salad child item).



WingsBuilder (only when item.slug === "wings-4u-special" — or when item.modifier_groups contains the salad group):





After the customer selects the salad type (existing extra-group step for saladTypeGroup), resolve salad_menu_item_id by matching the selected option’s name to a salad MenuItem in the salads category (slug map: caesar-salad, garden-salad, etc. — defined once in a small [lib/salad-catalog.ts](apps/web/src/lib/salad-catalog.ts) or derived from menu.categories).



Replace the generic “Ingredient removals” source: instead of item.removable_ingredients (parent), load removable + addon groups from the resolved salad MenuItem (passed via new optional prop saladMenuItems: MenuItem[] from menu-page, or filtered from the same menu response).



Submit wing line with removed_ingredients empty on parent for salad-specific removals; put salad removals + salad modifier selections inside builder_payload.salad_customization.



Checkout ([checkout.service.ts](apps/api/src/modules/checkout/checkout.service.ts)): when builderPayload.builder_type === "WINGS" and salad_customization is present, validate removals and modifier option IDs against salad_menu_item_id (load that MenuItem + removableIngredients / modifier joins), not only the parent Wings-4-U row.

Simpler MVP (not recommended long-term): keep a union of all ingredients on the parent — wrong UX and confusing validation.



4. Files likely to change (checklist)







Area



Files





Seed



[packages/database/prisma/seed.ts](packages/database/prisma/seed.ts) — category, 5 salads, size groups, chicken add-on group, expand saladTypeGroup options





Types



[apps/web/src/lib/types.ts](apps/web/src/lib/types.ts) — WingBuilderPayload.salad_customization





Wings UI



[apps/web/src/components/wings-builder.tsx](apps/web/src/components/wings-builder.tsx) — conditional salad UX + payload





Menu page



[apps/web/src/Wings4u/components/menu-page.tsx](apps/web/src/Wings4u/components/menu-page.tsx) — pass salad items into builder; ?cat=salads scroll





Nav



[apps/web/src/Wings4u/components/navbar.tsx](apps/web/src/Wings4u/components/navbar.tsx), possibly [styles.ts](apps/web/src/Wings4u/styles.ts)





API validation



[apps/api/src/modules/checkout/checkout.service.ts](apps/api/src/modules/checkout/checkout.service.ts) — validate salad_customization; [cart.service.ts](apps/api/src/modules/cart/cart.service.ts) if quote must include salad modifier cents





Emoji / notes



[menu-page.tsx](apps/web/src/Wings4u/components/menu-page.tsx) emojiForCategorySlug / categoryNoteForSlug



5. Testing checklist for your friend





/menu shows Salads section with five items, prices, sizes, descriptions.



Each salad opens overlay: size → ingredients → add-ons → chicken add-on respects size.



Wings-4-U Special: pick each salad type → removals/add-ons match that salad; order payload and checkout succeed.



Nav link(s): Menu + Salads deep-link scrolls to salads.

