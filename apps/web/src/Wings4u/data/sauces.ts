type MenuHeatLevel = "MILD" | "MEDIUM" | "HOT" | "DRY_RUB" | "PLAIN";

type MenuWingFlavour = {
  name: string;
  slug: string;
  heat_level: MenuHeatLevel;
  is_plain?: boolean;
  sort_order?: number;
};

const WING_FLAVOURS: MenuWingFlavour[] = [
  { name: "No Flavour (Plain)", slug: "no-flavour-plain", heat_level: "PLAIN", is_plain: true },
  { name: "BBQ", slug: "bbq", heat_level: "MILD" },
  { name: "Honey Garlic", slug: "honey-garlic", heat_level: "MILD" },
  { name: "Honey BBQ", slug: "honey-bbq", heat_level: "MILD" },
  { name: "Honey Dill", slug: "honey-dill", heat_level: "MILD" },
  { name: "Honey Ranch", slug: "honey-ranch", heat_level: "MILD" },
  { name: "Honey Smoke", slug: "honey-smoke", heat_level: "MILD" },
  { name: "Honey Gar-Par", slug: "honey-gar-par", heat_level: "MILD" },
  { name: "Maple BBQ", slug: "maple-bbq", heat_level: "MILD" },
  { name: "Maple Bacon", slug: "maple-bacon", heat_level: "MILD" },
  { name: "Sweet & Sour", slug: "sweet-and-sour", heat_level: "MILD" },
  { name: "Smoky BBQ", slug: "smoky-bbq", heat_level: "MILD" },
  { name: "Hickory BBQ", slug: "hickory-bbq", heat_level: "MILD" },
  { name: "Texas BBQ", slug: "texas-bbq", heat_level: "MILD" },
  { name: "Apple Butter Mesquite", slug: "apple-butter-mesquite", heat_level: "MILD" },
  { name: "Garlic Parm (Gar-Par)", slug: "garlic-parm", heat_level: "MILD" },
  { name: "BBQ Gar-Par", slug: "bbq-gar-par", heat_level: "MILD" },
  { name: "BBQ Ranch", slug: "bbq-ranch", heat_level: "MILD" },
  { name: "BBQ Blue Cheese", slug: "bbq-blue-cheese", heat_level: "MILD" },
  { name: "BBQ Dill", slug: "bbq-dill", heat_level: "MILD" },
  { name: "BBQ Smokey Ranch", slug: "bbq-smokey-ranch", heat_level: "MILD" },
  { name: "Creamy Dill / Honey Mustard", slug: "creamy-dill-honey-mustard", heat_level: "MILD" },
  { name: "Zesty Orange Ginger", slug: "zesty-orange-ginger", heat_level: "MILD" },
  { name: "Butter Chicken", slug: "butter-chicken", heat_level: "MILD" },
  { name: "Pineapple Curry", slug: "pineapple-curry", heat_level: "MILD" },
  { name: "Curry", slug: "curry", heat_level: "MILD" },
  { name: "Our Signature Sauce", slug: "signature-sauce", heat_level: "MEDIUM" },
  { name: "Lemon Pepper", slug: "lemon-pepper", heat_level: "MEDIUM" },
  { name: "Salt & Pepper", slug: "salt-and-pepper", heat_level: "MEDIUM" },
  { name: "Thai Sweet & Spicy", slug: "thai-sweet-and-spicy", heat_level: "MEDIUM" },
  { name: "Caribbean Jerk", slug: "caribbean-jerk", heat_level: "MEDIUM" },
  { name: "Chilli Lime", slug: "chilli-lime", heat_level: "MEDIUM" },
  { name: "Creamy Cajun", slug: "creamy-cajun", heat_level: "MEDIUM" },
  { name: "Whisky BBQ", slug: "whisky-bbq", heat_level: "MEDIUM" },
  { name: "Whisky Ranch", slug: "whisky-ranch", heat_level: "MEDIUM" },
  { name: "Smoked Tequila Lime", slug: "smoked-tequila-lime", heat_level: "MEDIUM" },
  { name: "Tequila Ranch", slug: "tequila-ranch", heat_level: "MEDIUM" },
  { name: "Tangy BBQ (Louis Style)", slug: "tangy-bbq-louis", heat_level: "MEDIUM" },
  { name: "Buffalo Honey", slug: "buffalo-honey", heat_level: "MEDIUM" },
  { name: "Buffalo Ranch", slug: "buffalo-ranch", heat_level: "MEDIUM" },
  { name: "Buffalo Blue", slug: "buffalo-blue", heat_level: "MEDIUM" },
  { name: "Hot Honey", slug: "hot-honey", heat_level: "MEDIUM" },
  { name: "Sriracha Lime", slug: "sriracha-lime", heat_level: "MEDIUM" },
  { name: "Spicy Ranch", slug: "spicy-ranch", heat_level: "MEDIUM" },
  { name: "Spicy Dill", slug: "spicy-dill", heat_level: "MEDIUM" },
  { name: "Spicy Gar-Par", slug: "spicy-gar-par", heat_level: "MEDIUM" },
  { name: "Spicy Honey Mustard", slug: "spicy-honey-mustard", heat_level: "MEDIUM" },
  { name: "Spicy Lemon Ranch", slug: "spicy-lemon-ranch", heat_level: "MEDIUM" },
  { name: "Spicy Cajun Ranch", slug: "spicy-cajun-ranch", heat_level: "MEDIUM" },
  { name: "Hot", slug: "hot", heat_level: "HOT" },
  { name: "Spicy Buffalo", slug: "spicy-buffalo", heat_level: "HOT" },
  { name: "Buffalo", slug: "buffalo", heat_level: "HOT" },
  { name: "Fire & Ice", slug: "fire-and-ice", heat_level: "HOT" },
  { name: "Jamaican Hot", slug: "jamaican-hot", heat_level: "HOT" },
  { name: "Hot Dill Pickle", slug: "hot-dill-pickle", heat_level: "HOT" },
  { name: "Nashville Hot", slug: "nashville-hot", heat_level: "HOT" },
  { name: "Mango Habanero", slug: "mango-habanero", heat_level: "HOT" },
  { name: "Mango Chipotle", slug: "mango-chipotle", heat_level: "HOT" },
  { name: "Habanero Lime", slug: "habanero-lime", heat_level: "HOT" },
  { name: "Sriracha Chilli", slug: "sriracha-chilli", heat_level: "HOT" },
  { name: "Spicy Peri-Peri", slug: "spicy-peri-peri", heat_level: "HOT" },
  { name: "Spicy Island", slug: "spicy-island", heat_level: "HOT" },
  { name: "Spicy Tandoori", slug: "spicy-tandoori", heat_level: "HOT" },
  { name: "Suicide", slug: "suicide", heat_level: "HOT" },
  { name: "Tex-Mex", slug: "tex-mex", heat_level: "HOT" },
  { name: "Cajun", slug: "cajun", heat_level: "DRY_RUB" },
  { name: "Lemon Pepper", slug: "lemon-pepper-dry-rub", heat_level: "DRY_RUB" },
  { name: "Salt & Pepper", slug: "salt-and-pepper-dry-rub", heat_level: "DRY_RUB" },
  { name: "Hot Dill Pickle", slug: "hot-dill-pickle-dry-rub", heat_level: "DRY_RUB" },
  { name: "Sriracha Lime", slug: "sriracha-lime-dry-rub", heat_level: "DRY_RUB" },
  { name: "Mango Chipotle", slug: "mango-chipotle-dry-rub", heat_level: "DRY_RUB" },
  { name: "Caribbean Jerk", slug: "caribbean-jerk-dry-rub", heat_level: "DRY_RUB" },
  { name: "Spicy Peri-Peri", slug: "spicy-peri-peri-dry-rub", heat_level: "DRY_RUB" },
  { name: "Garlic Parm", slug: "garlic-parm-dry-rub", heat_level: "DRY_RUB" },
  { name: "Maple Bacon", slug: "maple-bacon-dry-rub", heat_level: "DRY_RUB" },
  { name: "Buffalo", slug: "buffalo-dry-rub", heat_level: "DRY_RUB" },
  { name: "Nashville Hot", slug: "nashville-hot-dry-rub", heat_level: "DRY_RUB" },
  { name: "Thai Sweet & Spicy", slug: "thai-sweet-and-spicy-dry-rub", heat_level: "DRY_RUB" },
  { name: "Hot Honey", slug: "hot-honey-dry-rub", heat_level: "DRY_RUB" },
  { name: "Habanero Lime", slug: "habanero-lime-dry-rub", heat_level: "DRY_RUB" },
  { name: "BBQ", slug: "bbq-dry-rub", heat_level: "DRY_RUB" },
  { name: "Spicy Tandoori", slug: "spicy-tandoori-dry-rub", heat_level: "DRY_RUB" },
  { name: "Tex-Mex", slug: "tex-mex-dry-rub", heat_level: "DRY_RUB" },
];

export type SauceCategory = "mild" | "medium" | "hot" | "dryrub";

export const SAUCE_CATEGORY_ORDER = ["mild", "medium", "hot", "dryrub"] as const;

export type SauceFlavour = {
  id: string;
  slug: string;
  name: string;
  displayName: string;
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

function isMenuHeatLevel(value: string): value is MenuHeatLevel {
  return (
    value === "MILD" ||
    value === "MEDIUM" ||
    value === "HOT" ||
    value === "DRY_RUB" ||
    value === "PLAIN"
  );
}

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

const SOURCE_FLAVOURS = WING_FLAVOURS.filter(
  (flavour) => !flavour.is_plain && flavour.heat_level !== "PLAIN",
);

function mapSourceFlavoursToSauceFlavours(
  source: Array<Pick<MenuWingFlavour, "name" | "slug" | "heat_level" | "sort_order">>,
): SauceFlavour[] {
  const nameCounts = source.reduce<Record<string, number>>((counts, flavour) => {
    const key = flavour.name.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  const categoryNumbers: Record<SauceCategory, number> = {
    mild: 0,
    medium: 0,
    hot: 0,
    dryrub: 0,
  };

  return source.map((flavour) => {
    const cat =
      HEAT_LEVEL_TO_CATEGORY[flavour.heat_level as Exclude<MenuHeatLevel, "PLAIN">];
    const hasDuplicateName = (nameCounts[flavour.name.toLowerCase()] ?? 0) > 1;
    const displayName =
      cat === "dryrub" && hasDuplicateName && !/dry rub/i.test(flavour.name)
        ? `${flavour.name} Dry Rub`
        : flavour.name;
    categoryNumbers[cat] += 1;

    return {
      id: flavour.slug,
      slug: flavour.slug,
      name: flavour.name,
      displayName,
      cat,
      icon: pickSauceIcon(flavour.name, cat),
      visualAccent: pickSauceVisualAccent(flavour.name, cat),
      heat: deriveGridHeat(flavour.name, cat),
      carouselHeat: deriveCarouselHeat(cat),
      number: categoryNumbers[cat],
    };
  });
}

/** Build display sauces from live API wing-flavour rows (cached on the server). */
export function buildSauceFlavoursFromApi(
  flavours: Array<{
    name: string;
    slug: string;
    heat_level: string;
    is_plain?: boolean;
    sort_order?: number;
  }>,
): SauceFlavour[] {
  const source = flavours.flatMap((flavour) => {
    if (
      flavour.is_plain ||
      !isMenuHeatLevel(flavour.heat_level) ||
      flavour.heat_level === "PLAIN"
    ) {
      return [];
    }

    return [{
      name: flavour.name,
      slug: flavour.slug,
      heat_level: flavour.heat_level,
      sort_order: flavour.sort_order,
    }];
  });
  source.sort((left, right) => {
    const leftCategory =
      HEAT_LEVEL_TO_CATEGORY[left.heat_level as Exclude<MenuHeatLevel, "PLAIN">];
    const rightCategory =
      HEAT_LEVEL_TO_CATEGORY[right.heat_level as Exclude<MenuHeatLevel, "PLAIN">];
    const categoryDifference =
      SAUCE_CATEGORY_ORDER.indexOf(leftCategory) -
      SAUCE_CATEGORY_ORDER.indexOf(rightCategory);
    if (categoryDifference !== 0) return categoryDifference;

    const positionDifference =
      (left.sort_order ?? Number.MAX_SAFE_INTEGER) -
      (right.sort_order ?? Number.MAX_SAFE_INTEGER);
    if (positionDifference !== 0) return positionDifference;
    return left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug);
  });

  return mapSourceFlavoursToSauceFlavours(source);
}

export function deriveSauceCounts(flavours: SauceFlavour[]): Record<SauceCategory, number> {
  return flavours.reduce<Record<SauceCategory, number>>(
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
}

export function selectCarouselSauceFlavours(
  flavours: SauceFlavour[],
  perCategory = 5,
): SauceFlavour[] {
  const seen = new Set<string>();

  return SAUCE_CATEGORY_ORDER.flatMap((category) => {
    const selected: SauceFlavour[] = [];

    for (const sauce of flavours) {
      if (sauce.cat !== category) continue;

      const uniqueKey = sauce.slug || sauce.id;
      if (seen.has(uniqueKey)) continue;

      seen.add(uniqueKey);
      selected.push(sauce);

      if (selected.length >= perCategory) break;
    }

    return selected;
  });
}

export const SAUCE_FLAVOURS: SauceFlavour[] = mapSourceFlavoursToSauceFlavours(SOURCE_FLAVOURS);

export const SAUCE_TOTAL = SAUCE_FLAVOURS.length;
export const SAUCE_MARKETING_TOTAL = 74;

export const SAUCE_COUNTS = deriveSauceCounts(SAUCE_FLAVOURS);
