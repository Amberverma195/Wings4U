# Non-wing customization: read-only catalog review

**Production corrections: NOT EXECUTED. Explicit owner approval is required.**

Inspected 2026-10-18T08:53:47.363Z. PostgreSQL connection startup enforced default_transaction_read_only=on; inspection used a repeatable-read READ ONLY transaction and ROLLBACK. Queried only menu, ingredient, modifier and mapping tables. No orders, customers, payments, accounts or saved carts were queried or changed.

Snapshot: 87 items, 73 modifier groups, 789 options, 144 item/group links. Full menu-only evidence: [JSON report](non-wing-catalog-readonly.json). Dedicated wing configuration was excluded from ingredient findings.

## Confirmed causes

- Web formerly admitted unassociated extras through Add/Extra wording and token fallbacks, treated an empty recipe as a match, and rendered selected options before authorization. Size matching could bypass ingredient matching.
- Mobile formerly displayed every linked group without equivalent ingredient authorization.
- The live catalog differs from seed assumptions: Buffalo Chicken Wrap contains two distinct active Add Jalapenos option IDs in the same item-specific Extras group. These are duplicate option records, not duplicate composite-key link rows. Five other items have the same pattern.
- Veggie Burger avocado is explicitly marked __always__ in its dedicated Additional Ingredients group. Code must respect that item-level configuration; removing fallback matching cannot remove this record without an owner-approved catalog correction. Other avocado/jalapeno rows mostly have null mappings.
- Admin previously flattened legacy null mappings into Always available on an unrelated save. The new editor preserves unchanged extras and requires explicit approval/mapping when they are changed.

## Owner-confirmed unstocked extras

Proposal for every row: deactivate only the listed standalone option, retaining historical order snapshots and all prepared Jalapeno Popper products. Group requirements are optional; leaving max_select unchanged does not add a charge or invent choices. Existing carts using these IDs must review the item. Related groups and item IDs are recorded below and in JSON.

| Menu item | Item ID | Option | Option ID | Group ID | Current match | Proposed correction |
|---|---|---|---|---|---|---|
| Bacon Loaded Fries | f64b672b-b5ac-4366-ac7f-f133aa68a6cb | Add Jalapenos | 270c2c72-ec66-49c0-bd2b-261b82471a8f | 118293de-78a5-40f7-b283-b9d35b381640 | null | Deactivate option; NOT EXECUTED |
| Buffalo Chicken Burger | f3bc8293-7111-4086-98cf-b3c45d6cba9b | Add Avocado | a8461b7a-8347-4828-82c0-e8fccaa85c2e | f93ded03-edc6-46c6-af7b-4527b6bf6135 | null | Deactivate option; NOT EXECUTED |
| Buffalo Chicken Burger | f3bc8293-7111-4086-98cf-b3c45d6cba9b | Add Jalapenos | 0a29dca1-e548-4e49-9d07-51d9c46d7d90 | f93ded03-edc6-46c6-af7b-4527b6bf6135 | null | Deactivate option; NOT EXECUTED |
| Buffalo Chicken Wrap | 955f451a-b783-4501-9159-df3f4bd40de1 | Add Jalapenos | cfef13cb-aede-4de4-b8db-502fe386e539 | b43e956b-6e07-4654-aa7c-3215f0be865d | null | Deactivate option; NOT EXECUTED |
| Buffalo Chicken Wrap | 955f451a-b783-4501-9159-df3f4bd40de1 | Add Jalapenos | ddd855db-a8b6-4271-8770-468c4eb52456 | b43e956b-6e07-4654-aa7c-3215f0be865d | null | Deactivate option; NOT EXECUTED |
| Chicken Burger | a078cad2-e68f-405b-b391-c994adf6bb75 | Add Avocado | 3e89f009-bcd5-41e2-b22e-0040d0c3023f | adca8b24-6d5f-45c3-8728-f396c97c22e7 | null | Deactivate option; NOT EXECUTED |
| Chicken Burger | a078cad2-e68f-405b-b391-c994adf6bb75 | Add Jalapenos | 30cd0377-85ef-438f-a8b9-63ad748f02d9 | adca8b24-6d5f-45c3-8728-f396c97c22e7 | null | Deactivate option; NOT EXECUTED |
| Chicken Loaded Fries | dc6a64fc-baba-4f48-a873-254b0799f8ea | Add Jalapenos | 8bdbe6e7-5506-45bc-84f3-dea258ab1618 | 2d43e0ba-4591-43b8-bdf3-dadc025665d4 | null | Deactivate option; NOT EXECUTED |
| Chilli Cheese Fries | 5cf78284-b31a-435c-b8a5-9798da786bc4 | Add Jalapenos | 0ef76b1d-c7a7-4044-a5e0-e9fa43554db8 | b6b5bdbc-c0d2-4cb8-abbc-2e028d002047 | null | Deactivate option; NOT EXECUTED |
| Chilli Cheese Fries | 5cf78284-b31a-435c-b8a5-9798da786bc4 | Add Jalapenos | c1262673-3695-43cb-930f-5363163e8fea | b6b5bdbc-c0d2-4cb8-abbc-2e028d002047 | null | Deactivate option; NOT EXECUTED |
| Garden Chicken Wrap | babfb1eb-7fa7-494d-871d-c51bd67b4e08 | Add Jalapenos | 6b98e0ed-0db2-4bfd-965d-8860d528cfac | b44965be-53b0-4c4b-b74c-a277cc027a3f | null | Deactivate option; NOT EXECUTED |
| Garden Chicken Wrap | babfb1eb-7fa7-494d-871d-c51bd67b4e08 | Add Jalapenos | b4389a5d-2ade-4e87-9d92-b1685bb292df | b44965be-53b0-4c4b-b74c-a277cc027a3f | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Fries | 33038a26-5faf-41b3-af87-52d5c4084f61 | Add Jalapenos | 0fbd90e6-c1b1-4f1d-bc54-9a8a914fd429 | 7251e14d-11ef-4825-8ae7-a50a72e9c196 | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Fries | 33038a26-5faf-41b3-af87-52d5c4084f61 | Add Jalapenos | 4809aed1-f70f-4be4-8e2d-1199a1d0308f | 7251e14d-11ef-4825-8ae7-a50a72e9c196 | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Onion Rings | 4aca95dd-f780-4641-8140-d063892d8416 | Add Jalapenos | 2416aaac-4a1f-4817-9ec8-13d1d4fb0553 | 49e7e47a-23c2-4d6d-95eb-8c5c10c51ef4 | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Onion Rings | 4aca95dd-f780-4641-8140-d063892d8416 | Add Jalapenos | b2bae929-d247-4316-a9e2-3b3bf1430861 | 49e7e47a-23c2-4d6d-95eb-8c5c10c51ef4 | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Wedges | 0528fbe4-a946-448e-b4b8-5ab074e42dc0 | Add Jalapenos | 135bfab0-2c82-4ed1-a32d-ea4374e0fe36 | fd370748-1c40-43f2-950b-85aeb4cebc54 | null | Deactivate option; NOT EXECUTED |
| Spicy Gar-Par Wedges | 0528fbe4-a946-448e-b4b8-5ab074e42dc0 | Add Jalapenos | 706ce480-9ad7-4231-aa92-d20b6f52d70c | fd370748-1c40-43f2-950b-85aeb4cebc54 | null | Deactivate option; NOT EXECUTED |
| Veggie Burger | 16f7975f-375e-440e-8462-a3bc5898b355 | Add Avocado | 2ca79a96-b456-4e89-9648-df517964e8e1 | 199e4961-ad21-4f45-abf5-d75a9efcd150 | __always__ | Deactivate option; NOT EXECUTED |
| Veggie Wrap | a2143f99-738e-4840-b903-f5290733f342 | Add Avocado | 7f0c393a-1013-408d-8704-05969540371b | 91c19729-b394-464f-a381-38ef12a5abc6 | null | Deactivate option; NOT EXECUTED |

## Duplicate source records

Each set below has equal 100-cent prices and two active option records under one Extras group. Remove both standalone jalapeno choices after approval; do not choose a replacement ingredient or delete historical order modifiers. No price conflict or ID reuse was found in these duplicate sets.

| Item / ID | Group ID | Duplicate option IDs |
|---|---|---|
| Buffalo Chicken Wrap / 955f451a-b783-4501-9159-df3f4bd40de1 | b43e956b-6e07-4654-aa7c-3215f0be865d | cfef13cb-aede-4de4-b8db-502fe386e539, ddd855db-a8b6-4271-8770-468c4eb52456 |
| Chilli Cheese Fries / 5cf78284-b31a-435c-b8a5-9798da786bc4 | b6b5bdbc-c0d2-4cb8-abbc-2e028d002047 | 0ef76b1d-c7a7-4044-a5e0-e9fa43554db8, c1262673-3695-43cb-930f-5363163e8fea |
| Garden Chicken Wrap / babfb1eb-7fa7-494d-871d-c51bd67b4e08 | b44965be-53b0-4c4b-b74c-a277cc027a3f | 6b98e0ed-0db2-4bfd-965d-8860d528cfac, b4389a5d-2ade-4e87-9d92-b1685bb292df |
| Spicy Gar-Par Fries / 33038a26-5faf-41b3-af87-52d5c4084f61 | 7251e14d-11ef-4825-8ae7-a50a72e9c196 | 0fbd90e6-c1b1-4f1d-bc54-9a8a914fd429, 4809aed1-f70f-4be4-8e2d-1199a1d0308f |
| Spicy Gar-Par Onion Rings / 4aca95dd-f780-4641-8140-d063892d8416 | 49e7e47a-23c2-4d6d-95eb-8c5c10c51ef4 | 2416aaac-4a1f-4817-9ec8-13d1d4fb0553, b2bae929-d247-4316-a9e2-3b3bf1430861 |
| Spicy Gar-Par Wedges / 0528fbe4-a946-448e-b4b8-5ab074e42dc0 | fd370748-1c40-43f2-950b-85aeb4cebc54 | 135bfab0-2c82-4ed1-a32d-ea4374e0fe36, 706ce480-9ad7-4231-aa92-d20b6f52d70c |

## Other authorization candidates requiring menu-owner review

35 additional active options lack current authorization under strict ingredient rules. This is a review list, not a claim that every product is discontinued. For each row, the owner should either select an existing recipe ingredient, explicitly approve a stocked off-recipe extra for this item, or remove the extra. Preserve the listed price; do not infer missing records or prices. All affected item/group relationships are in JSON. Changing extras through the replace-all admin editor can replace option IDs on that item, so existing customized carts may need review even for retained extras.

| Menu item / ID | Option / ID | Group ID | Match | Proposed action |
|---|---|---|---|---|
| Bacon Loaded Fries / f64b672b-b5ac-4366-ac7f-f133aa68a6cb | Add Chicken / 43a2802d-d8ef-413a-969c-9a3710593a76 | 118293de-78a5-40f7-b283-b9d35b381640 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Buffalo Chicken Burger / f3bc8293-7111-4086-98cf-b3c45d6cba9b | Extra Cheese / 6780dfab-b73f-41a9-9d86-2d13a15a17e0 | f93ded03-edc6-46c6-af7b-4527b6bf6135 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Buffalo Chicken Burger / f3bc8293-7111-4086-98cf-b3c45d6cba9b | Extra Ranch / c79df52e-457e-4ebd-b1a1-62f6e62b67ec | f93ded03-edc6-46c6-af7b-4527b6bf6135 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Buffalo Chicken Burger / f3bc8293-7111-4086-98cf-b3c45d6cba9b | Add Bacon / f499330c-19f3-4c2b-9c7f-b8fa5d09262e | f93ded03-edc6-46c6-af7b-4527b6bf6135 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Buffalo Chicken Wrap / 955f451a-b783-4501-9159-df3f4bd40de1 | Extra Chicken / a3da5c58-c736-49e0-973f-e28908e9c93e | b43e956b-6e07-4654-aa7c-3215f0be865d | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Caesar Salad / 5514a089-935e-4a92-b1f7-92714541187c | Add fresh hand breaded chicken (Small) / 51b8a0bf-f614-4298-8ede-f73da3775f37 | 62299561-3465-4eb7-b700-99c94cef211f | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Caesar Salad / 5514a089-935e-4a92-b1f7-92714541187c | Add fresh hand breaded chicken (Large) / 0a82f9f5-90ec-4edd-a767-568f6ae8af39 | 62299561-3465-4eb7-b700-99c94cef211f | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Cajun Lemon Pepper Fries / 84d3890e-6445-4eda-bdb1-0c438d645afa | Extra Cheese / f41a8566-097f-4f95-9bb8-1c58d6c098fc | 89bc033c-90a2-4842-a0e0-4f0347308d44 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Burger / a078cad2-e68f-405b-b391-c994adf6bb75 | Extra Cheese / b046e6ed-fb60-4926-8f74-1160cfef8baa | adca8b24-6d5f-45c3-8728-f396c97c22e7 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Burger / a078cad2-e68f-405b-b391-c994adf6bb75 | Extra Sauce / 1830a0a8-6a0f-416e-851e-1b358903cc5f | adca8b24-6d5f-45c3-8728-f396c97c22e7 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Burger / a078cad2-e68f-405b-b391-c994adf6bb75 | Add Bacon / decdbe20-1876-49f7-b866-442708d3b736 | adca8b24-6d5f-45c3-8728-f396c97c22e7 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Caesar Wrap / 326da761-b7d8-4412-a4b3-64bd7106c275 | Extra Chicken / 0f3aa1bf-b0e7-4814-9c6e-3dea13a09443 | 5c10cb6b-429d-44eb-9f21-c0c13094549b | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Caesar Wrap / 326da761-b7d8-4412-a4b3-64bd7106c275 | Add Bacon / de579be2-85f1-40a6-b2cf-8d400372fa67 | 5c10cb6b-429d-44eb-9f21-c0c13094549b | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Chicken Loaded Fries / dc6a64fc-baba-4f48-a873-254b0799f8ea | Add Bacon / 645e7221-0bf8-429a-8ea2-89aa33c779b1 | 2d43e0ba-4591-43b8-bdf3-dadc025665d4 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Creamy Dill Fries / 978c14e3-5d37-43a5-9629-e886550f5a89 | Extra Cheese / 46bcb23f-6c29-4236-b876-7ec4003e30be | 18924a9c-ea84-42a3-b63d-33781a6fa48b | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Creamy Dill Fries / 978c14e3-5d37-43a5-9629-e886550f5a89 | Add Bacon / b372bd7d-cd5a-4ac8-8e82-66d917fc13f0 | 18924a9c-ea84-42a3-b63d-33781a6fa48b | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Fries / f4901296-1ebd-498c-a342-bce666123e7c | Extra Cheese / 697fdd1d-cadb-4d41-a24a-947d08393d4f | c408ba79-0fee-4afa-90de-4f09f5312441 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Fries / f4901296-1ebd-498c-a342-bce666123e7c | Add Bacon / 94032a07-740b-4ca5-bc78-fda644a574c9 | c408ba79-0fee-4afa-90de-4f09f5312441 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Onion Rings / 0e97f2eb-1124-4351-b4d2-70a08cb35ed6 | Extra Cheese / 39bc8b44-a9f4-4f1c-9fa6-b7ef23d815ac | 1c67de5e-07bb-47f2-920f-d3cfed9f2f3e | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Onion Rings / 0e97f2eb-1124-4351-b4d2-70a08cb35ed6 | Add Bacon / 724458c0-52e3-4d04-bfd0-3ddc87965981 | 1c67de5e-07bb-47f2-920f-d3cfed9f2f3e | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Wedges / 5a3d4cfd-ac33-49ee-b4ab-6ae5426c783b | Extra Cheese / c0851c2f-6245-49ad-8bbd-e73d94618161 | fb023631-04aa-466d-9856-b9a88221c950 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Gar-Par Wedges / 5a3d4cfd-ac33-49ee-b4ab-6ae5426c783b | Add Bacon / 71f4ec23-26b5-4520-8244-bf80692cd05d | fb023631-04aa-466d-9856-b9a88221c950 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Garden Chicken Wrap / babfb1eb-7fa7-494d-871d-c51bd67b4e08 | Extra Chicken / 0f1852ca-fd85-4af9-832f-2d6ae0d7653e | b44965be-53b0-4c4b-b74c-a277cc027a3f | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Garden Salad / 63687204-6d9f-487b-88bd-12dd1f355b7f | Add fresh hand breaded chicken (Small) / 53b78118-7ac1-4b92-8194-34b9ed738708 | fc759f16-775d-489d-8421-262c8be371cf | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Garden Salad / 63687204-6d9f-487b-88bd-12dd1f355b7f | Add fresh hand breaded chicken (Large) / 6ed252f3-6ed3-43a1-9189-50d01dfc81c8 | fc759f16-775d-489d-8421-262c8be371cf | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Greek Chicken Wrap / 63382c0d-d0ce-43fb-97e7-570ffd84e203 | Extra Chicken / fb4aa124-490d-4a3e-a0cf-2ae67ff1a98b | 98417e3a-2739-4aa2-b68c-b2f5a995170c | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Greek Fries / 08b2679f-3166-40dc-ac90-59715969dcb3 | Add Olives / ef210e32-838d-43fc-ba68-bd5bb6629bfa | ff0fda6f-bd06-4891-bfd6-a3cb93f82965 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Greek Salad / 311cf0b0-f73f-47d3-97b5-8cbabe61540f | Add fresh hand breaded chicken (Small) / e2fc5649-30fe-4cb3-b275-1607b61a7db6 | 39ee54b1-7456-4e64-a816-ded3f502a2f5 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Greek Salad / 311cf0b0-f73f-47d3-97b5-8cbabe61540f | Add fresh hand breaded chicken (Large) / ff760c5a-3ee1-461d-8446-5b38a88916cc | 39ee54b1-7456-4e64-a816-ded3f502a2f5 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Horiatiki Salad / b6bf512a-2037-4495-a719-0c1c2c366a7f | Add fresh hand breaded chicken (Small) / 54237df4-baf1-46b0-926e-0ee32e1236e2 | 592375fb-a0b9-451c-ba03-aba7a3f52a9d | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Horiatiki Salad / b6bf512a-2037-4495-a719-0c1c2c366a7f | Add fresh hand breaded chicken (Large) / 5a8163da-5d4d-45d2-9010-e4a741c7901d | 592375fb-a0b9-451c-ba03-aba7a3f52a9d | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Spicy Gar-Par Fries / 33038a26-5faf-41b3-af87-52d5c4084f61 | Extra Cheese / 923af507-2612-458d-960a-5bdb83f5aabe | 7251e14d-11ef-4825-8ae7-a50a72e9c196 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Spicy Gar-Par Onion Rings / 4aca95dd-f780-4641-8140-d063892d8416 | Extra Cheese / dfec677c-7979-42eb-bb79-6fa76f776a46 | 49e7e47a-23c2-4d6d-95eb-8c5c10c51ef4 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Spicy Gar-Par Wedges / 0528fbe4-a946-448e-b4b8-5ab074e42dc0 | Extra Cheese / aeb4385c-09da-4e54-9eb6-e98be50ec233 | fd370748-1c40-43f2-950b-85aeb4cebc54 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |
| Veggie Wrap / a2143f99-738e-4840-b903-f5290733f342 | Add Feta / 62e50e9a-d421-47e0-b233-8ad836d63246 | 91c19729-b394-464f-a381-38ef12a5abc6 | null | Owner maps ingredient, explicitly approves item scope, or removes; NOT EXECUTED |

## Recipe and missing-choice review

- 3pc Chicken Tender + Small Fry + Pop (680289b7-faab-4425-9eb5-d8617608ab8b): Tender has no obvious dip group. Verify business requirements; do not invent records.
- Butter Chicken Poutine (5d1e6b99-35da-410f-b83a-30ea06b47252): ingredient Gravy (c4351372-d541-4f00-8f07-97bfbca72aa9) is absent from description wording. Description: Fries, Real Cheese Curds, Red onion, Tomato, Fresh Hand breaded Chicken, premium Butter Chicken Ssauce.. Owner verifies synonyms/recipe; no automatic ingredient change.
- Chilli Cheese Fries (5cf78284-b31a-435c-b8a5-9798da786bc4): ingredient Cheese (10ceb579-385a-4edb-a6ac-cb101ec560af) is absent from description wording. Description: Red meat chilli. Owner verifies synonyms/recipe; no automatic ingredient change.

Lunch burger/wrap parents intentionally delegate ingredient configuration to the selected child; they are not missing parent recipe records. No linked shared add-on groups were present in this snapshot. Legacy reusable groups remain in code definitions and are handled by the new fail-closed rules. None of the detected duplicate sets had a pricing conflict.

## Application plan after explicit approval

1. Review the exact IDs and current prices in this report against the latest live menu. Keep the read-only snapshot as evidence, not as an executable import.
2. Approve the 20 standalone option deactivations. The accompanying SQL is entirely commented and marked NOT EXECUTED; it contains no product deletion, price changes, or historical-order updates.
3. Separately decide the 35 authorization candidates, two description/recipe questions and lunch-tender dip requirement. Use existing API IDs and owner-confirmed prices only.
4. After approved changes are applied through admin or an owner-run transaction, invalidate the location catalog cache and Next catalog tags using the existing services. Direct SQL does not automatically emit admin invalidation/realtime events.
5. Verify fresh web/mobile builders and stale-cart review. Previously affected carts must be edited explicitly before checkout.

No migration, seed, sync, db push, reset, production correction, deployment or merge was performed.
