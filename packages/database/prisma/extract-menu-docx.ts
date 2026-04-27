/**
 * Extract menu data from the store's Word doc into a diffable JSON artifact.
 *
 * NOTE: To avoid adding new zip/xml deps, this uses PowerShell/.NET to read
 * `word/document.xml` from the `.docx` and returns paragraph text.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type HeatLevel = "MILD" | "MEDIUM" | "HOT" | "DRY_RUB";

type ExtractedMenu = {
  meta: {
    version: 1;
    source_docx: string;
    extracted_at: string;
  };
  location: {
    address_line_1: string;
    city: string;
    province_code: string;
    postal_code: string;
    phone_number: string;
  };
  categories: Array<{
    name: string;
    slug: string;
    sort_order: number;
    items: Array<{
      name: string;
      slug: string;
      description?: string;
      base_price_cents: number;
    }>;
  }>;
  wing_pricing: Array<{
    weight_lb: number;
    required_flavour_count: number;
    price_cents: number;
  }>;
  wing_combo_pricing: Array<{
    weight_lb: number;
    price_cents: number;
    description?: string;
  }>;
  wing_flavours: Array<{
    name: string;
    slug: string;
    heat_level: HeatLevel;
  }>;
  notes: Record<string, unknown>;
};

function usageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      "Usage: tsx prisma/extract-menu-docx.ts <path-to-docx> [--out <path-to-json>] [--lines-json <path-to-lines-json>]",
      "Example:",
      "  tsx prisma/extract-menu-docx.ts \"Docs/This menu for Wings 4 U contains a wide variety of wings.docx\" --out Docs/menu/wings4u-menu.v1.json",
    ].join("\n"),
  );
  process.exit(code);
}

function escapePowershellSingleQuoted(s: string) {
  return s.replace(/'/g, "''");
}

function readDocxLinesViaPowerShell(docxPath: string): string[] {
  if (process.platform !== "win32") {
    throw new Error(
      `extract-menu-docx currently requires Windows PowerShell (platform=${process.platform}).`,
    );
  }

  const docxAbs = path.resolve(docxPath);
  const docxPs = escapePowershellSingleQuoted(docxAbs);

  const ps = `
$ErrorActionPreference='Stop';
$docx='${docxPs}';
Add-Type -AssemblyName System.IO.Compression;
Add-Type -AssemblyName System.IO.Compression.FileSystem;
$zip=[System.IO.Compression.ZipFile]::OpenRead($docx);
try {
  $entry=$zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' } | Select-Object -First 1;
  if (-not $entry) { throw 'word/document.xml not found'; }
  $sr=New-Object System.IO.StreamReader($entry.Open());
  $xml=$sr.ReadToEnd(); $sr.Close();
  [xml]$x=$xml;
  $ns=New-Object System.Xml.XmlNamespaceManager($x.NameTable);
  $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  $paras=$x.SelectNodes('//w:p',$ns);
  $lines=New-Object System.Collections.Generic.List[string];
  foreach ($p in $paras) {
    $ts=$p.SelectNodes('.//w:t',$ns) | ForEach-Object { $_.'#text' };
    if ($ts.Count -eq 0) { continue; }
    $line=($ts -join '');
    if ($line.Trim().Length -eq 0) { continue; }
    $lines.Add($line.Trim());
  }
  $lines | ConvertTo-Json -Compress;
} finally {
  $zip.Dispose();
}
`.trim();

  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );

  if (res.status !== 0) {
    throw new Error(res.stderr || `PowerShell failed with status ${res.status}`);
  }

  const out = (res.stdout ?? "").trim();
  if (!out) throw new Error("PowerShell returned empty output.");

  const parsed = JSON.parse(out) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error("Unexpected PowerShell output shape.");
  }

  return parsed as string[];
}

function toCents(money: string): number {
  const trimmed = money.trim();
  const m =
    trimmed.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/) ??
    trimmed.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!m) throw new Error('Could not parse money: "' + money + '"');
  const n = Number.parseFloat(m[1]);
  return Math.round(n * 100);
}

function phoneToE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s || "item";
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let i = 2;
  while (used.has(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  used.add(slug);
  return slug;
}

function findIndex(lines: string[], exact: string, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i] === exact) return i;
  }
  return -1;
}

function sliceSection(lines: string[], start: number, end: number) {
  return lines.slice(start, end).filter((l) => l.trim().length > 0);
}

function isDashCell(s: string) {
  const t = s.trim();
  return t === "-" || t === "--" || t === "\u2014" || t === "\u2014 \u2014";
}

function parseLocation(lines: string[]) {
  const locLine = lines.find((l) => l.startsWith("Location:"));
  const phoneLine = lines.find((l) => l.startsWith("Phone:"));

  if (!locLine || !phoneLine) {
    throw new Error("Location/Phone not found in doc.");
  }

  const loc = locLine.replace(/^Location:\s*/i, "").trim();
  // Expected: "1544 Dundas Street East, London, ON N5W 3C1"
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  const addressLine1 = parts[0] ?? "";
  const city = parts[1] ?? "";
  const provPostal = (parts[2] ?? "").split(/\s+/).filter(Boolean);
  const provinceCode = provPostal[0] ?? "";
  const postalCode = provPostal.slice(1).join(" ");

  const phoneRaw = phoneLine.replace(/^Phone:\s*/i, "").trim();

  return {
    address_line_1: addressLine1,
    city,
    province_code: provinceCode,
    postal_code: postalCode,
    phone_number: phoneToE164(phoneRaw),
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usageAndExit(1);

  const docx = argv[0];
  let outPath = "Docs/menu/wings4u-menu.v1.json";
  let linesJsonPath: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      outPath = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (a === "--lines-json") {
      linesJsonPath = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") usageAndExit(0);
  }

  let lines: string[];
  if (linesJsonPath) {
    const linesAbs = path.resolve(linesJsonPath);
    const raw = fs.readFileSync(linesAbs, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      throw new Error("--lines-json must be a JSON array of strings.");
    }
    lines = (parsed as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
  } else {
    lines = readDocxLinesViaPowerShell(docx);
  }

  const idxLunch = findIndex(lines, "Lunch Specials");
  const idxWings = findIndex(lines, "Wings", Math.max(0, idxLunch));
  const idxWingCombos = findIndex(lines, "Wing Combos", Math.max(0, idxWings));
  const idxFlavours = findIndex(lines, "Flavours (by Heat/Type)", Math.max(0, idxWingCombos));
  const idxBurgersTenders = findIndex(lines, "Burgers & Tenders", Math.max(0, idxFlavours));
  const idxWraps = findIndex(lines, "Wraps", Math.max(0, idxBurgersTenders));
  const idxPoutines = findIndex(lines, "Poutines & Sides", Math.max(0, idxWraps));
  const idxApps = findIndex(lines, "Appetizers & Extras", Math.max(0, idxPoutines));
  const idxDipsDrinks = findIndex(lines, "Dips & Drinks:", Math.max(0, idxApps));

  if (
    [idxLunch, idxWings, idxWingCombos, idxFlavours, idxBurgersTenders, idxWraps, idxPoutines, idxApps, idxDipsDrinks].some(
      (x) => x < 0,
    )
  ) {
    throw new Error("Failed to find required headings in the doc. The doc format may have changed.");
  }

  const location = parseLocation(lines);

  const usedItemSlugs = new Set<string>();
  const mkItem = (name: string, priceCents: number, description?: string) => ({
    name,
    slug: uniqueSlug(slugify(name), usedItemSlugs),
    description: description?.trim() ? description.trim() : undefined,
    base_price_cents: priceCents,
  });

  const categories: ExtractedMenu["categories"] = [];

  // Always create the full category set (even if some are empty), in the stable PRD order.
  categories.push({ name: "Lunch Specials", slug: "lunch-specials", sort_order: 1, items: [] });
  categories.push({ name: "Wings", slug: "wings", sort_order: 2, items: [] });
  categories.push({ name: "Wing Combos", slug: "wing-combos", sort_order: 3, items: [] });
  categories.push({ name: "Burgers", slug: "burgers", sort_order: 4, items: [] });
  categories.push({ name: "Tenders", slug: "tenders", sort_order: 5, items: [] });
  categories.push({ name: "Wraps", slug: "wraps", sort_order: 6, items: [] });
  categories.push({ name: "Poutines & Sides", slug: "poutines-sides", sort_order: 7, items: [] });
  categories.push({ name: "Specialty Fries", slug: "specialty-fries", sort_order: 8, items: [] });
  categories.push({ name: "Appetizers & Extras", slug: "appetizers-extras", sort_order: 9, items: [] });
  categories.push({ name: "Dips", slug: "dips", sort_order: 10, items: [] });
  categories.push({ name: "Drinks", slug: "drinks", sort_order: 11, items: [] });
  categories.push({ name: "Dessert", slug: "dessert", sort_order: 12, items: [] });
  categories.push({ name: "Specials", slug: "specials", sort_order: 13, items: [] });

  const cat = (slug: string) => {
    const c = categories.find((x) => x.slug === slug);
    if (!c) throw new Error(`Missing category ${slug}`);
    return c;
  };

  // Lunch specials (all $9.99)
  const lunchLines = sliceSection(lines, idxLunch + 1, idxWings);
  const lunchPriceLine = lunchLines.find((l) => /\$9\.99/.test(l));
  const lunchPriceCents = lunchPriceLine ? toCents(lunchPriceLine) : 999;
  for (const line of lunchLines) {
    if (!/\+\s*1\s*pop/i.test(line)) continue;
    cat("lunch-specials").items.push(mkItem(`Lunch Special: ${line}`, lunchPriceCents, line));
  }


  // Burgers & tenders
  const burgersLines = sliceSection(lines, idxBurgersTenders + 1, idxWraps);
  const comboUpgradeLine = burgersLines.find((l) => /Add .* & 1 pop:/i.test(l));
  const comboUpgradePriceCents = comboUpgradeLine ? toCents(comboUpgradeLine) : 499;

  const burgerNote = "All buns are toasted with butter.";

  const burgersItems: Array<{
    name: string;
    slug: string;
    description?: string;
    base_price_cents: number;
  }> = [];

  const tendersItems: Array<{
    name: string;
    slug: string;
    description?: string;
    base_price_cents: number;
  }> = [];

  for (const line of burgersLines) {
    const m = line.match(/^(.*?)(?::\s*(.*?))?\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/);
    if (!m) continue;
    const rawName = m[1].trim();
    const rawDesc = m[2]?.trim();
    const priceCents = toCents(m[3]);

    // "Make it a combo" is an upgrade option, not a standalone menu item.
    if (/^Add .* & 1 pop/i.test(rawName)) {
      continue;
    }

    if (/burger/i.test(rawName)) {
      const desc = rawDesc?.trim() ? burgerNote + " " + rawDesc.trim() : burgerNote;
      burgersItems.push(mkItem(rawName, priceCents, desc));
      continue;
    }

    // Tenders + tender combos
    let finalName = rawName;
    let finalDesc = rawDesc;

    const pc = rawName.match(/(\d+)\s*pc/i)?.[1];
    const isCombo = /^Combo\s*\(/i.test(rawName);

    if (isCombo) {
      if (pc === "3") {
        finalName = "Chicken Tender Combo (3 pc)";
        finalDesc = "3 pc tenders + small side + 1 dip (2 oz.) + 1 pop";
      } else if (pc === "5") {
        finalName = "Chicken Tender Combo (5 pc)";
        finalDesc = "5 pc tenders + large side + 1 dip (4 oz.) + 1 pop";
      }
    } else if (!isCombo && pc && (/tenders/i.test(rawName) || /dip/i.test(rawName))) {
      if (pc === "3") {
        finalName = "3 pc Tenders + 1 Dip (2 oz.)";
        finalDesc = undefined;
      } else if (pc === "5") {
        finalName = "5 pc Tenders + 1 Dip (2 oz.)";
        finalDesc = undefined;
      } else if (pc === "10") {
        finalName = "10 pc Tenders + 1 Dip (4 oz.)";
        finalDesc = undefined;
      }
    }

    tendersItems.push(mkItem(finalName, priceCents, finalDesc));
  }

  // Force curated order (API uses created_at ordering to preserve this).
  const burgerOrder = ["Veggie Burger", "Chicken Burger", "Buffalo Chicken Burger"];
  burgersItems.sort((a, b) => {
    const ai = burgerOrder.indexOf(a.name);
    const bi = burgerOrder.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.name.localeCompare(b.name);
  });

  const tendersOrder = [
    "3 pc Tenders + 1 Dip (2 oz.)",
    "5 pc Tenders + 1 Dip (2 oz.)",
    "10 pc Tenders + 1 Dip (4 oz.)",
    "Chicken Tender Combo (3 pc)",
    "Chicken Tender Combo (5 pc)",
  ];
  tendersItems.sort((a, b) => {
    const ai = tendersOrder.indexOf(a.name);
    const bi = tendersOrder.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.name.localeCompare(b.name);
  });

  cat("burgers").items.push(...burgersItems);
  cat("tenders").items.push(...tendersItems);

  // Wraps
  const wrapsLines = sliceSection(lines, idxWraps + 1, idxPoutines);
  const anyWrapLine = wrapsLines.find((l) => /Any wrap:\s*\$/i.test(l));
  const wrapPriceCents = anyWrapLine ? toCents(anyWrapLine) : 999;
  for (const line of wrapsLines) {
    const m = line.match(/^(.+?):\s*(.+)$/);
    if (!m) continue;
    if (!/wrap/i.test(m[1])) continue;
    cat("wraps").items.push(mkItem(m[1].trim(), wrapPriceCents, m[2].trim()));
  }

  // Poutines & sides table + specialty fries list
  const poutinesLines = sliceSection(lines, idxPoutines + 1, idxApps);
  const idxSpecialtyFries = poutinesLines.findIndex((l) => l === "Specialty Fries:");
  const poutineTable = idxSpecialtyFries >= 0 ? poutinesLines.slice(0, idxSpecialtyFries) : poutinesLines;
  const specialtyLines = idxSpecialtyFries >= 0 ? poutinesLines.slice(idxSpecialtyFries + 1) : [];

  const hdrIdx = poutineTable.findIndex((l) => l === "Item");
  if (hdrIdx >= 0) {
    const rows = poutineTable.slice(hdrIdx + 3); // skip Item/Small/Large
    for (let i = 0; i + 2 < rows.length; i += 3) {
      const itemName = rows[i];
      const small = rows[i + 1];
      const large = rows[i + 2];
      if (!/\$/.test(small) || !/\$/.test(large)) continue;

      if (/^Fries\s*\//i.test(itemName)) {
        const parts = itemName.split("/").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          cat("poutines-sides").items.push(mkItem(`${p} (Small)`, toCents(small)));
          cat("poutines-sides").items.push(mkItem(`${p} (Large)`, toCents(large)));
        }
        continue;
      }

      cat("poutines-sides").items.push(mkItem(`${itemName} (Small)`, toCents(small)));
      cat("poutines-sides").items.push(mkItem(`${itemName} (Large)`, toCents(large)));
    }
  }

  for (const line of specialtyLines) {
    const m = line.match(/^(.*?)\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/);
    if (!m) continue;

    const rawName = m[1].trim();
    const price = toCents(m[2]);

    if (/^Creamy Dill\s*\/\s*Gar-Par Fries/i.test(rawName)) {
      cat("specialty-fries").items.push(mkItem("Creamy Dill Fries", price, "Regular or Spicy"));
      cat("specialty-fries").items.push(mkItem("Gar-Par Fries", price, "Regular or Spicy"));
      continue;
    }

    if (/^Gar-Par Onion Rings\s*\/\s*Wedges/i.test(rawName)) {
      cat("specialty-fries").items.push(mkItem("Gar-Par Onion Rings", price, "Regular or Spicy"));
      cat("specialty-fries").items.push(mkItem("Gar-Par Wedges", price, "Regular or Spicy"));
      continue;
    }

    cat("specialty-fries").items.push(mkItem(rawName, price));
  }

  // Appetizers & extras
  const appsLines = sliceSection(lines, idxApps + 1, idxDipsDrinks);
  for (const line of appsLines) {
    const lg = line.match(
      /^Loaded Garlic Bread\s+\(4pc\s+\/\s+8pc\):\s+Plain\s+\(\$([0-9.]+)\/\$([0-9.]+)\),\s+Cheese\s+\(\$([0-9.]+)\/\$([0-9.]+)\),\s+Cheese\s+&\s+Bacon\s+\(\$([0-9.]+)\/\$([0-9.]+)\)/i,
    );
    if (lg) {
      const variants = [
        { name: "Loaded Garlic Bread Plain", s: lg[1], l: lg[2] },
        { name: "Loaded Garlic Bread Cheese", s: lg[3], l: lg[4] },
        { name: "Loaded Garlic Bread Cheese & Bacon", s: lg[5], l: lg[6] },
      ];
      for (const v of variants) {
        cat("appetizers-extras").items.push(mkItem(`${v.name} (4pc)`, toCents(v.s)));
        cat("appetizers-extras").items.push(mkItem(`${v.name} (8pc)`, toCents(v.l)));
      }
      continue;
    }

    const m = line.match(/^(.*?)(?::\s*(.*?))?\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/);
    if (!m) continue;

    const name = m[1].trim();
    const desc = m[2]?.trim();
    const price = toCents(m[3]);

    if (/^Cheddar Cheese Cubes\s*\//i.test(name)) {
      const parts = m[1].split("/").map((p) => p.trim()).filter(Boolean);
      for (const p of parts) cat("appetizers-extras").items.push(mkItem(p, price));
      continue;
    }

    if (/^Breaded Pickle Spears\s*\//i.test(name)) {
      const parts = m[1].split("/").map((p) => p.trim()).filter(Boolean);
      for (const p of parts) cat("appetizers-extras").items.push(mkItem(p, price));
      continue;
    }

    if (/^Chicken Loaded Fries\s*\//i.test(name)) {
      const parts = m[1].split("/").map((p) => p.trim()).filter(Boolean);
      for (const p of parts) cat("appetizers-extras").items.push(mkItem(p, price));
      continue;
    }

    if (/Wings-4-U Special/i.test(name)) {
      cat("specials").items.push(mkItem("Wings-4-U Special", price, desc));
      continue;
    }

    cat("appetizers-extras").items.push(mkItem(name, price, desc));
  }

  // Dips / drinks / dessert
  const tailLines = sliceSection(lines, idxDipsDrinks + 1, lines.length);
  for (const line of tailLines) {
    const dips = line.match(/^Dips:\s*(.*?)\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/i);
    if (dips) {
      cat("dips").items.push(mkItem("Dip", toCents(dips[2]), dips[1]));
      continue;
    }

    const pw = line.match(/^Pop\s*\/\s*Water:\s*\$([0-9]+\.[0-9]{2})\s*\/\s*\$([0-9]+\.[0-9]{2})$/i);
    if (pw) {
      cat("drinks").items.push(mkItem("Pop", toCents(pw[1])));
      cat("drinks").items.push(mkItem("Water", toCents(pw[2])));
      continue;
    }

    const energy = line.match(/^Energy Drink:\s*\$([0-9]+\.[0-9]{2})$/i);
    if (energy) {
      cat("drinks").items.push(mkItem("Energy Drink", toCents(energy[1])));
      continue;
    }

    const dessert = line.match(/^Dessert:\s*(.*?)\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/i);
    if (dessert) {
      cat("dessert").items.push(mkItem(dessert[1].trim(), toCents(dessert[2])));
      continue;
    }
  }

  // Wing pricing table
  const wingsLines = sliceSection(lines, idxWings + 1, idxWingCombos);
  const qIdx = wingsLines.findIndex((l) => l === "Quantity");
  const wingPricing: ExtractedMenu["wing_pricing"] = [];
  let extraFlavourCents = 100;
  if (qIdx >= 0) {
    const rows = wingsLines.slice(qIdx + 3); // Quantity / Flavours / Price
    for (let i = 0; i + 2 < rows.length; i += 3) {
      const qty = rows[i];
      const flav = rows[i + 1];
      const price = rows[i + 2];
      if (!/\$/.test(price)) continue;

      if (/Extra Flavour/i.test(qty)) {
        extraFlavourCents = toCents(price);
        continue;
      }

      const w = Number.parseFloat(qty.replace(/[^0-9.]/g, ""));
      const fc = Number.parseInt(flav.replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(w) || !Number.isFinite(fc)) continue;
      wingPricing.push({ weight_lb: w, required_flavour_count: fc, price_cents: toCents(price) });
    }
  }

  // Wing combo pricing list
  const comboLines = sliceSection(lines, idxWingCombos + 1, idxFlavours);
  const wingComboPricing: ExtractedMenu["wing_combo_pricing"] = [];
  for (const line of comboLines) {
    const m = line.match(/^(.+?):\s*(.*?)\s+\u2014\s+\$([0-9]+\.[0-9]{2})$/);
    if (!m) continue;
    const w = Number.parseFloat(m[1].replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(w)) continue;
    wingComboPricing.push({ weight_lb: w, price_cents: toCents(m[3]), description: m[2]?.trim() || undefined });
  }

  // Flavour table: parse 4-column cells after headers.
  const flavourLines = sliceSection(lines, idxFlavours + 1, idxBurgersTenders);
  const headerStart = flavourLines.findIndex((l) => l === "Mild");
  const start = headerStart >= 0 ? headerStart + 4 : 0;
  const cells = flavourLines.slice(start).filter((c) => c.trim().length > 0);

  const wingFlavours: ExtractedMenu["wing_flavours"] = [];
  const flavourUsed = new Set<string>();
  const cols: HeatLevel[] = ["MILD", "MEDIUM", "HOT", "DRY_RUB"];

  for (let i = 0; i + 3 < cells.length; i += 4) {
    for (let col = 0; col < 4; col++) {
      const name = cells[i + col];
      if (isDashCell(name)) continue;
      const slug = slugify(name);
      if (flavourUsed.has(slug)) continue;
      flavourUsed.add(slug);
      wingFlavours.push({ name, slug, heat_level: cols[col] });
    }
  }

  const out: ExtractedMenu = {
    meta: {
      version: 1,
      source_docx: docx,
      extracted_at: new Date().toISOString(),
    },
    location,
    categories,
    wing_pricing: wingPricing,
    wing_combo_pricing: wingComboPricing,
    wing_flavours: wingFlavours,
    notes: {
      combo_upgrade_price_cents: comboUpgradePriceCents,
      extra_flavour_price_cents: extraFlavourCents,
    },
  };

  const outAbs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(out, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outAbs}`);
}

main();
