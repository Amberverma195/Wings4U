import menuData from "../../../../../Docs/menu/wings4u-menu.v1.json";

type MenuHeatLevel = "MILD" | "MEDIUM" | "HOT" | "DRY_RUB" | "PLAIN";

type MenuWingFlavour = {
  name: string;
  slug: string;
  heat_level: MenuHeatLevel;
  is_plain?: boolean;
};

export type SauceCategory = "mild" | "medium" | "hot" | "dryrub";

export type SauceFlavour = {
  id: string;
  slug: string;
  name: string;
  cat: SauceCategory;
  icon: string;
  visualAccent: string;
  heat: number;
  carouselHeat: 1 | 2 | 3 | 4;
  number: number;
};

export const SAUCE_CATEGORY_META = {
  mild: {
    label: "Mild",
    badge: "MILD",
    accent: "#4cd964",
  },
  medium: {
    label: "Medium",
    badge: "MEDIUM",
    accent: "#ffcc00",
  },
  hot: {
    label: "Hot",
    badge: "HOT",
    accent: "#ff4d00",
  },
  dryrub: {
    label: "Dry Rubs",
    badge: "DRY RUBS",
    accent: "#cc66ff",
  },
} as const;

const HEAT_LEVEL_TO_CATEGORY: Record<Exclude<MenuHeatLevel, "PLAIN">, SauceCategory> = {
  MILD: "mild",
  MEDIUM: "medium",
  HOT: "hot",
  DRY_RUB: "dryrub",
};

const ICON_RULES: Array<[RegExp, string]> = [
  [/(honey|maple)/i, String.fromCodePoint(0x1f36f)],
  [/(garlic|gar-par)/i, String.fromCodePoint(0x1f9c4)],
  [/(parm|blue cheese|creamy dill)/i, String.fromCodePoint(0x1f9c0)],
  [/(bbq|mesquite|hickory|smok)/i, String.fromCodePoint(0x1f356)],
  [/(lemon|lime|orange|citrus)/i, String.fromCodePoint(0x1f34b)],
  [/(dill|pickle)/i, String.fromCodePoint(0x1f952)],
  [/(mango|pineapple)/i, String.fromCodePoint(0x1f34d)],
  [/(tequila|whisky)/i, String.fromCodePoint(0x1f943)],
  [/(curry)/i, String.fromCodePoint(0x1f35b)],
  [/(sweet & sour)/i, String.fromCodePoint(0x1f36f)],
  [/(fire|hot|suicide|spicy|buffalo|sriracha|habanero)/i, String.fromCodePoint(0x1f525)],
  [/(jerk|peri|tandoori|cajun|chipotle)/i, String.fromCodePoint(0x1f336, 0xfe0f)],
];

function pickSauceIcon(name: string, cat: SauceCategory): string {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(name)) {
      return icon;
    }
  }

  switch (cat) {
    case "mild":
      return String.fromCodePoint(0x1f357);
    case "medium":
      return String.fromCodePoint(0x1f336, 0xfe0f);
    case "hot":
      return String.fromCodePoint(0x1f525);
    case "dryrub":
      return String.fromCodePoint(0x2728);
    default:
      return String.fromCodePoint(0x1f357);
  }
}

function pickSauceVisualAccent(name: string, cat: SauceCategory): string {
  if (/blue cheese/i.test(name)) {
    return "#78b7ff";
  }

  if (/(creamy dill|dill|pickle)/i.test(name)) {
    return "#7bdb63";
  }

  if (/(garlic|gar-par|parm)/i.test(name)) {
    return "#f3e4a1";
  }

  if (/(honey|maple)/i.test(name)) {
    return "#ffd24a";
  }

  if (/(bbq|mesquite|hickory|smok|bacon)/i.test(name)) {
    return "#c86b26";
  }

  if (/(lemon|lime|orange|citrus)/i.test(name)) {
    return "#ffe66a";
  }

  if (/(mango|pineapple)/i.test(name)) {
    return "#ff9a1f";
  }

  if (/(tequila|whisky)/i.test(name)) {
    return "#ffb347";
  }

  if (/(curry|signature)/i.test(name)) {
    return "#f5c542";
  }

  if (/(sweet & sour|sweet)/i.test(name)) {
    return "#ffc94d";
  }

  if (/(fire|hot|suicide|spicy|buffalo|sriracha|habanero)/i.test(name)) {
    return "#ff5b2e";
  }

  if (/(jerk|peri|tandoori|cajun|chipotle)/i.test(name)) {
    return "#ff7a3d";
  }

  switch (cat) {
    case "mild":
      return "#ffd24a";
    case "medium":
      return "#ffb347";
    case "hot":
      return "#ff5b2e";
    case "dryrub":
      return "#f3e4a1";
    default:
      return "#ffd24a";
  }
}

function deriveGridHeat(name: string, cat: SauceCategory): number {
  if (cat === "mild") {
    return /(cajun|orange|ginger)/i.test(name) ? 2 : 1;
  }

  if (cat === "medium") {
    return /(thai|curry|tequila|whisky|buffalo honey)/i.test(name) ? 3 : 2;
  }

  if (cat === "hot") {
    return /(suicide|mango habanero|fire|sriracha|spicy honey mustard|spicy island)/i.test(name) ? 5 : 4;
  }

  return /(nashville|hot honey|spicy|tandoori|peri|jerk|chipotle|thai sweet)/i.test(name) ? 3 : 2;
}

function deriveCarouselHeat(cat: SauceCategory): 1 | 2 | 3 | 4 {
  switch (cat) {
    case "mild":
      return 1;
    case "medium":
      return 2;
    case "hot":
      return 4;
    case "dryrub":
      return 2;
    default:
      return 1;
  }
}

const SOURCE_FLAVOURS = (menuData.wing_flavours as MenuWingFlavour[]).filter(
  (flavour) => !flavour.is_plain && flavour.heat_level !== "PLAIN",
);

export const SAUCE_FLAVOURS: SauceFlavour[] = SOURCE_FLAVOURS.map((flavour, index) => {
  const cat = HEAT_LEVEL_TO_CATEGORY[flavour.heat_level as Exclude<MenuHeatLevel, "PLAIN">];

  return {
    id: flavour.slug,
    slug: flavour.slug,
    name: flavour.name,
    cat,
    icon: pickSauceIcon(flavour.name, cat),
    visualAccent: pickSauceVisualAccent(flavour.name, cat),
    heat: deriveGridHeat(flavour.name, cat),
    carouselHeat: deriveCarouselHeat(cat),
    number: index + 1,
  };
});

export const SAUCE_TOTAL = SAUCE_FLAVOURS.length;

export const SAUCE_COUNTS = SAUCE_FLAVOURS.reduce<Record<SauceCategory, number>>(
  (counts, sauce) => {
    counts[sauce.cat] += 1;
    return counts;
  },
  {
    mild: 0,
    medium: 0,
    hot: 0,
    dryrub: 0,
  },
);
