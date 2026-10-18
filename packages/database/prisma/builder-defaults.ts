// Historical defaults for offline comparison only. Never authoritative for an existing menu.
function addonOptionsFromRemovableIngredients(
  ingredients: string[],
  priceCents = 50,
): Array<{ name: string; price: number; scopeIngredientName: string }> {
  return ingredients.map((ing) => ({
    name: `Extra ${ing}`,
    price: priceCents,
    scopeIngredientName: ing,
  }));
}

const VEGGIE_BURGER_REMOVABLES = [
  "Sriracha Mayo",
  "Lettuce",
  "Red Onion",
  "Tomato",
  "Signature Sauce",
];
const CHICKEN_BURGER_REMOVABLES = [
  "Sriracha Mayo",
  "Lettuce",
  "Red Onion",
  "Tomato",
  "Thai Sauce",
];
const BUFFALO_BURGER_REMOVABLES = ["Sriracha Mayo", "Lettuce", "Red Onion", "Tomato"];

export const SCOPED_ADDON_SPECS = {
  "veggie-burger": {
    groupName: "Veggie Burger Extras",
    displayLabel: "Veggie Burger extras",
    options: addonOptionsFromRemovableIngredients(VEGGIE_BURGER_REMOVABLES),
  },
  "chicken-burger": {
    groupName: "Chicken Burger Extras",
    displayLabel: "Chicken Burger extras",
    options: addonOptionsFromRemovableIngredients(CHICKEN_BURGER_REMOVABLES),
  },
  "buffalo-chicken-burger": {
    groupName: "Buffalo Chicken Burger Extras",
    displayLabel: "Buffalo Chicken Burger extras",
    options: addonOptionsFromRemovableIngredients(BUFFALO_BURGER_REMOVABLES),
  },
  "veggie-wrap": {
    groupName: "Veggie Wrap Extras",
    displayLabel: "Veggie Wrap extras",
    options: [
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
      { name: "Add Feta", price: 150 },
    ],
  },
  "chicken-caesar-wrap": {
    groupName: "Chicken Caesar Wrap Extras",
    displayLabel: "Chicken Caesar Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Parm Cheese", price: 100, scopeIngredientName: "Parm Cheese" },
      { name: "Extra Caesar Dressing", price: 50, scopeIngredientName: "Caesar Dressing" },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "buffalo-chicken-wrap": {
    groupName: "Buffalo Chicken Wrap Extras",
    displayLabel: "Buffalo Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Sriracha Mayo", price: 50, scopeIngredientName: "Sriracha Mayo" },
    ],
  },
  "garden-chicken-wrap": {
    groupName: "Garden Chicken Wrap Extras",
    displayLabel: "Garden Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese Blend" },
      { name: "Extra Ranch", price: 50, scopeIngredientName: "Ranch" },
    ],
  },
  "greek-chicken-wrap": {
    groupName: "Greek Chicken Wrap Extras",
    displayLabel: "Greek Chicken Wrap extras",
    options: [
      { name: "Extra Chicken", price: 250 },
      { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
      { name: "Extra Greek Dressing", price: 50, scopeIngredientName: "Greek Dressing" },
      { name: "Add Olives", price: 100, scopeIngredientName: "Black Olives" },
    ],
  },
  "regular-poutine": {
    groupName: "Regular Poutine Extras",
    displayLabel: "Regular Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
    ],
  },
  "bacon-poutine": {
    groupName: "Bacon Poutine Extras",
    displayLabel: "Bacon Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Bacon", price: 150, scopeIngredientName: "Bacon" },
    ],
  },
  "buffalo-chicken-poutine": {
    groupName: "Buffalo Chicken Poutine Extras",
    displayLabel: "Buffalo Chicken Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Buffalo Chicken", price: 250, scopeIngredientName: "Buffalo Chicken" },
    ],
  },
  "butter-chicken-poutine": {
    groupName: "Butter Chicken Poutine Extras",
    displayLabel: "Butter Chicken Poutine extras",
    options: [
      { name: "Extra Gravy", price: 100, scopeIngredientName: "Gravy" },
      { name: "Extra Cheese Curds", price: 200, scopeIngredientName: "Cheese Curds" },
      { name: "Add Butter Chicken", price: 250, scopeIngredientName: "Butter Chicken" },
    ],
  },
  "cajun-lemon-pepper-fries": {
    groupName: "Cajun Lemon Pepper Fries Extras",
    displayLabel: "Cajun Lemon Pepper Fries extras",
    options: [
      { name: "Extra Cajun Seasoning", price: 50, scopeIngredientName: "Cajun Seasoning" },
      { name: "Extra Lemon Pepper", price: 50, scopeIngredientName: "Lemon Pepper" },
      { name: "Extra Cheese", price: 100 },
    ],
  },
  "creamy-dill-fries": {
    groupName: "Creamy Dill Fries Extras",
    displayLabel: "Creamy Dill Fries extras",
    options: [
      { name: "Extra Creamy Dill Sauce", price: 50, scopeIngredientName: "Creamy Dill Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "gar-par-fries": {
    groupName: "Gar-Par Fries Extras",
    displayLabel: "Gar-Par Fries extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-fries": {
    groupName: "Spicy Gar-Par Fries Extras",
    displayLabel: "Spicy Gar-Par Fries extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
    ],
  },
  "gar-par-onion-rings": {
    groupName: "Gar-Par Onion Rings Extras",
    displayLabel: "Gar-Par Onion Rings extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-onion-rings": {
    groupName: "Spicy Gar-Par Onion Rings Extras",
    displayLabel: "Spicy Gar-Par Onion Rings extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
    ],
  },
  "gar-par-wedges": {
    groupName: "Gar-Par Wedges Extras",
    displayLabel: "Gar-Par Wedges extras",
    options: [
      { name: "Extra Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
      { name: "Add Bacon", price: 150 },
    ],
  },
  "spicy-gar-par-wedges": {
    groupName: "Spicy Gar-Par Wedges Extras",
    displayLabel: "Spicy Gar-Par Wedges extras",
    options: [
      { name: "Extra Spicy Garlic Parmesan Sauce", price: 50, scopeIngredientName: "Spicy Garlic Parmesan Sauce" },
      { name: "Extra Cheese", price: 100 },
    ],
  },
  "greek-fries": {
    groupName: "Greek Fries Extras",
    displayLabel: "Greek Fries extras",
    options: [
      { name: "Extra Feta", price: 150, scopeIngredientName: "Feta" },
      { name: "Extra Tzatziki", price: 50, scopeIngredientName: "Tzatziki" },
      { name: "Add Olives", price: 100 },
    ],
  },
  "chilli-cheese-fries": {
    groupName: "Chilli Cheese Fries Extras",
    displayLabel: "Chilli Cheese Fries extras",
    options: [
      { name: "Extra Chilli", price: 100, scopeIngredientName: "Red Meat Chilli" },
      { name: "Extra Cheese", price: 100, scopeIngredientName: "Cheese" },
    ],
  },
} as const;
