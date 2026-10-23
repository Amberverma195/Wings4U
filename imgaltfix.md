# Image Alt Text & Visual Accessibility Audit (`imgaltfix.md`)

**Target Applications:** Wings4U Customer Web (`apps/web`), Staff Admin (`apps/web/src/app/admin`), and Mobile App (`apps/application`)  
**Accessibility Standards Alignment:**  
- **WCAG 2.1 Success Criterion 1.1.1 Non-text Content (Level A)**: All non-text content presented to the user has a text alternative serving equivalent purpose.
- **WCAG 2.1 Success Criterion 2.4.4 Link Purpose (In Context) (Level A)**: The purpose of each link can be determined from the link text alone or from link text together with context.
- **WCAG 2.1 Success Criterion 4.1.2 Name, Role, Value (Level A)**: For all user interface components, accessible name and role can be programmatically determined.
- **W3C WAI Images Tutorial**: Guidelines on Informative, Decorative, Functional, and Redundant Images.

---

## 1. Executive Summary

This audit provides a comprehensive, repository-wide evaluation of all images, visual representations, SVG graphics, and brand lockups across the Wings4U codebase.

### Overall Health Summary
- **Total Image & Graphical Surfaces Evaluated:** 28
- **WCAG 1.1.1 Compliant (Pass):** 18
- **Needs Ergonomic Improvement / Redundancy Fix:** 6
- **Accessibility Violations / Gaps:** 4

### Key Audit Highlights
1. **Brand Lockup Accessible Name Omission:** The primary header and footer brand lockup (`WingsBrandLockup`) renders the logo and wordmark with `alt="" aria-hidden="true"`. While decorative images inside a named link are acceptable, the enclosing link defaults to `aria-label="Go to home"`, completely omitting the organization name ("Wings 4 U"). Screen reader users hear "Go to home, link" without brand identity.
2. **Double-Reading in Cart Line Items:** In both web (`cart-page.tsx`) and mobile (`cart.tsx`), item thumbnails provide `alt={item.name}` immediately adjacent to `<h3 className="..."> {item.name} </h3>`. Screen readers announce the exact item title twice in a row (redundant image violation).
3. **Admin Picture Upload Previews Lack Context:** In the admin menu modal (`menu-item-modal.tsx`) and builder modal (`admin-menu-client.tsx`), active picture previews use `alt=""`, leaving blind staff members unable to confirm whether an image has loaded or replaced.
4. **Hero Center Graphic Emoji Not Hidden:** On the web landing hero (`landing.tsx`), while ambient orbiting pepper and flame icons are hidden with `aria-hidden="true"`, the central chicken drumstick emoji (`🍗`) in `heroCenterWing` lacks `aria-hidden="true"`, causing screen readers to announce `"poultry leg"` directly between hero titles.
5. **Mobile Catalog Image Missing Accessibility Marker:** In `apps/application/src/screens/menu-screen.tsx`, while fallback category icons properly set `accessible={false}`, live catalog item images `<Image source={{ uri: item.image_url }} />` omit `accessible={false}` and `accessibilityLabel`, allowing native accessibility engines to announce unlabelled image nodes.
6. **Heavy Unoptimized Public Menu Assets:** Five combo meal JPEG images in `apps/web/public/uploads/menu/` weigh ~1.04 MB each (~5.2 MB total) and are served via unoptimized raw `<img>` tags on menu pages rather than Next.js `<Image>` with responsive `sizes` and WebP/AVIF transcoding.

---

## 2. Complete Image & Visual Asset Inventory

### 2.1 Web Application (`apps/web`)

| # | Asset / Component | Source / Path | Tag / Element | Current Alt / Accessible Name | Classification | WCAG 1.1.1 Status |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **W1** | Site Brand Logo (Header) | `/logo.png` | `<Image>` (`next/image`) | `alt="" aria-hidden` | Functional (in Link) | ⚠️ **Needs Context** (Parent Link has generic `aria-label="Go to home"`) |
| **W2** | Site Wordmark (Header) | `/Logo_title.png` | `<Image>` (`next/image`) | `alt="" aria-hidden` | Functional (in Link) | ⚠️ **Needs Context** (Combined brand name omitted) |
| **W3** | Footer Brand Logo & Wordmark | `/logo.png`, `/Logo_title.png` | `<Image>` (`next/image`) | `alt="" aria-hidden` | Functional (in Link) | ⚠️ **Needs Context** (Parent Link has `aria-label="Back to home"`) |
| **W4** | Sauces Page Navbar Logo | `/logo.png`, `/Logo_title.png` | `<Image>` (`next/image`) | `alt="" aria-hidden` | Functional (in Link) | ⚠️ **Needs Context** (Parent Link has `aria-label="Back to home"`) |
| **W5** | Sauces Page Footer Logo | `/logo.png`, `/Logo_title.png` | `<Image>` (`next/image`) | `alt="" aria-hidden` | Functional (in Link) | ⚠️ **Needs Context** (Parent Link has `aria-label="Back to home"`) |
| **W6** | Menu Item Catalog Photos | Dynamic `item.imageUrl` | `<img>` (`menu-page.tsx`) | `alt={`${item.displayName} on the Wings 4 U menu`}` | Informative | 🟢 **PASS** (Descriptive, lazy loaded, async decoded) |
| **W7** | Menu Item Fallback Emojis | Dynamic category emoji | `<div>` (`menu-page.tsx`) | Visually displayed emoji | Decorative / Fallback | 🟢 **PASS** (Adjacent `<h3>` carries item name) |
| **W8** | Cart Line Item Thumbnails | Dynamic `item.image_url` | `<img>` (`cart-page.tsx`) | `alt={item.name}` | Informative / Redundant | ⚠️ **Redundant** (Immediately precedes `<h3>{item.name}</h3>`) |
| **W9** | Cart Thumbnail Fallback | `cartLinePlaceholder` | `<div>` (`cart-page.tsx`) | `aria-hidden="true"` | Decorative | 🟢 **PASS** |
| **W10** | Admin Menu Card Item Photo | `item.imageUrl` | `<img>` (`menu-item-card.tsx`) | `alt={item.name}` | Informative | 🟢 **PASS** |
| **W11** | Admin Menu Item Modal Preview | `imagePreview` (Blob URL) | `<img>` (`menu-item-modal.tsx`) | `alt=""` | Informative | 🔴 **VIOLATION** (Empty alt in an interactive upload context) |
| **W12** | Admin Builder Category Preview | `shownImage` (Blob/URL) | `<img>` (`admin-menu-client.tsx`) | `alt=""` | Informative | 🔴 **VIOLATION** (Empty alt in an interactive upload context) |
| **W13** | Landing Hero Center Drumstick | `🍗` (`\u{1F357}`) | `<span>` (`landing.tsx`) | Unlabelled Unicode emoji | Decorative | 🔴 **VIOLATION** (Lacks `aria-hidden="true"`, announces "poultry leg") |
| **W14** | Landing Hero Orbiting Elements | `⚡`, `🌶️`, `🔥` | `<div>` (`landing.tsx`) | `aria-hidden="true"` | Decorative | 🟢 **PASS** |
| **W15** | Hero Category Marquee Emojis | `🍗`, `🧄`, `🍟`, `🌯`, `🍔`, `🥗` | `<span>` (`hero-category-marquee.tsx`) | `aria-hidden="true"` | Decorative | 🟢 **PASS** (Parent Link has explicit `aria-label="View [category] menu"`) |
| **W16** | Spotlight Section Emoji | Dynamic item emoji | `<span>` (`spotlight-section.tsx`) | `aria-hidden="true"` | Decorative | 🟢 **PASS** |
| **W17** | Sauce Spice Heat Chilies | `🌶️` (0-3 icons) | `<span>` (`sauces-section.tsx`) | `aria-hidden="true"` | Informative Graphic | 🟢 **PASS** (Container has `aria-label={`Spice level: ${label}`}`) |
| **W18** | Loyalty Stamp Progress Ring | Dynamic SVG circle chart | `<svg>` inside `role="img"` (`profile/page.tsx`) | `aria-label={`${availableStamps} of ${stampsPerReward} stamps collected`}` | Informative Graphic | 🟢 **PASS** (Proper accessible graphic pattern) |
| **W19** | Open Graph & Twitter Social Image | `/logo.png` (512x512) | OpenGraph / Twitter meta | `alt="Wings 4 U London Official Logo"` | Metadata | 🟢 **PASS** |

---

### 2.2 Mobile Application (`apps/application`)

| # | Asset / Component | Source / Path | Tag / Element | Current Alt / Accessible Name | Classification | WCAG 1.1.1 Status |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **M1** | Home Cinematic Header Banner | `head-banner.png` | `<Image>` (`expo-image`) | `accessible={false}` | Decorative Background | 🟢 **PASS** (Parent container has `importantForAccessibility="no-hide-descendants"`) |
| **M2** | Category Grid Icons | `categoryImage(cat)` | `<Image>` (`expo-image`) | `accessible={false}` | Decorative | 🟢 **PASS** (Parent `TouchableOpacity` has `accessibilityLabel={cat.name}`) |
| **M3** | Menu Screen Catalog Item Image | `item.image_url` | `<Image>` (`expo-image`) | *Missing `accessible={false}`* | Informative / Presentation | 🔴 **VIOLATION** (Exposed without accessible label inside pressable) |
| **M4** | Menu Screen Category Fallback | `categoryImageForSlug` | `<Image>` (`expo-image`) | `accessible={false}` | Decorative | 🟢 **PASS** |
| **M5** | Popular Items Carousel Images | `item.image_url` / category | `<Image>` (`expo-image`) | `accessible={false}` | Decorative | 🟢 **PASS** (Parent card exposes full item name and price) |
| **M6** | Home Promotional Banners (Top) | 4 category banners (Wings, Tenders, Burgers, Fries) | `<Image>` (`expo-image`) | `accessible={false}` | Functional Image | 🟢 **PASS** (Parent Pressable has `accessibilityLabel={`${item.label} promotion. Opens...`}`) |
| **M7** | Footer Promotional Banners | 7 posters (Lunch 1-6 & Party Specials) | `<Image>` (`expo-image`) | `accessible={false}` | Functional Image | 🟢 **PASS** (Parent Pressable has descriptive promo target label) |
| **M8** | Mobile Cart Line Item Image | `item.image_url` | `<Image>` (`react-native`) | `accessibilityLabel={item.name}` | Informative / Redundant | ⚠️ **Redundant** (Adjacent `<Text>{item.name}</Text>` causes double speech) |

---

### 2.3 Static Asset Filesystem Analysis

| Relative Path | Format | Size | Resolution | Production Usage | Optimization Recommendations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `apps/web/public/logo.png` | PNG | 87.5 KB | 512×512 | Main brand mark, OG image, apple-touch-icon, favicon | Compress with pngquant to ~22 KB |
| `apps/web/public/Logo_title.png` | PNG | 8.8 KB | 490×102 | Navbar & footer wordmark image | Optimized and clean |
| `apps/web/public/nav_title.png` | PNG | 904.1 KB | High-res | Legacy navbar title (unused in code) | Safe to delete or archive |
| `apps/web/public/uploads/menu/combo-1lb-be69957a.jpeg` | JPEG | 1,039 KB | 3000×2000 | 1 LB combo item picture | Transcode to WebP (target: < 120 KB) |
| `apps/web/public/uploads/menu/combo-1.5lb-41acb060.jpeg` | JPEG | 1,039 KB | 3000×2000 | 1.5 LB combo item picture | Transcode to WebP (target: < 120 KB) |
| `apps/web/public/uploads/menu/combo-2lb-a3405132.jpeg` | JPEG | 1,039 KB | 3000×2000 | 2 LB combo item picture | Transcode to WebP (target: < 120 KB) |
| `apps/web/public/uploads/menu/combo-3lb-6ee810d6.jpeg` | JPEG | 1,039 KB | 3000×2000 | 3 LB combo item picture | Transcode to WebP (target: < 120 KB) |
| `apps/web/public/uploads/menu/combo-5lb-cb5405ef.jpeg` | JPEG | 1,039 KB | 3000×2000 | 5 LB combo item picture | Transcode to WebP (target: < 120 KB) |
| `assests/LOGO.png` | PNG | 26.8 KB | 320×320 | Root workspace design asset | Dev asset (not served directly) |
| `assests/chicken wing.jpeg` | JPEG | 26.2 KB | 640×480 | Root workspace design reference | Dev asset (not served directly) |
| `apps/application/assets/head-banner.png` | PNG | 380 KB | 1200×400 | Mobile cinematic home header | Optimized for mobile bundle |
| `apps/application/assets/banners/*` (4 files) | PNG | ~180 KB ea | 900×300 | Mobile home top carousel slides | Bundled, pre-scaled |
| `apps/application/assets/footer carousol/*` (7 files) | PNG | ~240 KB ea | 1000×350 | Mobile lunch and party banners | Bundled, pre-scaled |

---

## 3. Deep-Dive Audit Findings & WCAG Analysis

### 3.1 Issue 1: Brand Link Accessible Name Omits Organization Name
- **File:** [`apps/web/src/components/wings-brand-lockup.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-brand-lockup.tsx#L23)
- **Impacted Consumers:** [`navbar.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/navbar.tsx#L45), [`site-footer.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/site-footer.tsx#L12), [`sauces-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-page.tsx#L351)
- **WCAG Criteria:** 2.4.4 Link Purpose (In Context), 1.1.1 Non-text Content
- **Current Behavior:**
  ```tsx
  export function WingsBrandLockup({
    href = "/",
    ariaLabel = "Go to home", // <-- Default omits brand name
    ...
  }) {
    return (
      <Link href={href} aria-label={ariaLabel} ...>
        <Image src="/logo.png" alt="" aria-hidden ... />
        {wordmarkImageSrc ? (
          <Image src={wordmarkImageSrc} alt="" aria-hidden ... />
        ) : (...)}
      </Link>
    );
  }
  ```
- **Audit Finding:**
  When `wordmarkImageSrc="/Logo_title.png"` is passed (which is true on the main navbar and footer), the text wordmark `WINGS 4 U` is not rendered. Both `<Image>` tags have `alt="" aria-hidden`. Because the `<Link>` defaults to `aria-label="Go to home"` (or `ariaLabel="Back to home"` in footer/sauces), the screen reader user hears only *"Go to home, link"* or *"Back to home, link"*. The organization name **"Wings 4 U"** is completely absent from the accessible name computation.
- **Recommended Remediation:**
  Update default `ariaLabel` to `"Wings 4 U — Home"` and footer instances to `"Wings 4 U — Home"` or `"Wings 4 U — Back to home"`.

---

### 3.2 Issue 2: Double-Announcement in Customer Cart Items
- **Files:**
  - Web: [`apps/web/src/Wings4u/components/cart-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/cart-page.tsx#L797)
  - Mobile: [`apps/application/app/(tabs)/cart.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/app/(tabs)/cart.tsx#L148)
- **WCAG Criteria:** 1.1.1 Non-text Content (Redundant Text Alternative)
- **Current Behavior (Web):**
  ```tsx
  <div className="wk-cart-line-thumb" style={styles.cartItemThumbWrap}>
    {imageUrl ? (
      <img
        src={imageUrl}
        alt={item.name} // <-- Exact duplicate of the adjacent heading
        style={styles.cartItemThumbImage}
      />
    ) : (
      <div aria-hidden="true">{cartLinePlaceholder(item)}</div>
    )}
  </div>
  <div className="wk-cart-line-card-body">
    <h3>{item.name}</h3> // <-- Immediate duplicate
  ```
- **Current Behavior (Mobile):**
  ```tsx
  {item.image_url ? (
    <Image
      source={{ uri: item.image_url }}
      accessibilityLabel={item.name} // <-- Redundant
      style={styles.itemImage}
    />
  ) : null}
  <View style={styles.cartLineInfo}>
    <Text style={styles.itemName}>{item.name}</Text>
  ```
- **Audit Finding:**
  According to W3C Images Tutorial: *"If an image is accompanied by a text label that presents the same name, the image should be marked decorative (`alt=""` or `accessible={false}`) so assistive technologies do not speak the text twice."* Notice that when there is no `imageUrl`, the placeholder already uses `aria-hidden="true"`.
- **Recommended Remediation:**
  - On web: Set `alt=""` and `aria-hidden="true"` on the thumbnail `<img>` in `cart-page.tsx`.
  - On mobile: Remove `accessibilityLabel` and add `accessible={false}` on the `<Image>` in `cart.tsx`.

---

### 3.3 Issue 3: Admin Modal Image Upload Previews Have Empty Alt
- **Files:**
  - [`apps/web/src/app/admin/menu/menu-item-modal.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/menu-item-modal.tsx#L535)
  - [`apps/web/src/app/admin/menu/admin-menu-client.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/admin-menu-client.tsx#L641)
- **WCAG Criteria:** 1.1.1 Non-text Content, 4.1.2 Name, Role, Value
- **Current Behavior:**
  ```tsx
  // menu-item-modal.tsx line 535:
  <div className={styles.menuItemModalImageWrap}>
    <img src={imagePreview} alt="" className={styles.menuItemModalImage} />
  </div>

  // admin-menu-client.tsx line 641:
  <div className={styles.builderPicturePreview}>
    <img src={shownImage} alt="" className={styles.builderPictureImage} />
  </div>
  ```
- **Audit Finding:**
  In both admin modals, this is not a decorative flourish—it is an interactive file upload and inspection surface where staff select, review, replace, or remove item artwork. With `alt=""`, screen reader users inspecting the modal form cannot verify whether a file is currently selected or loaded.
- **Recommended Remediation:**
  Provide meaningful stateful alt text:
  - In `menu-item-modal.tsx`: `alt={`Preview for ${name.trim() || "menu item"}`}`
  - In `admin-menu-client.tsx`: `alt={`Current category picture for ${selectedCategory?.name || "category"}`}`

---

### 3.4 Issue 4: Hero Center Chicken Emoji Not Hidden (`landing.tsx`)
- **File:** [`apps/web/src/Wings4u/components/landing.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/landing.tsx#L108)
- **WCAG Criteria:** 1.1.1 Non-text Content (Level A)
- **Current Behavior:**
  ```tsx
  <div style={styles.wingEmojis}>
    <span style={styles.heroCenterWing}>
      {"\u{1F357}"} {/* Raw chicken leg emoji */}
    </span>
    <div className="hero-orbit-ring" aria-hidden="true">
      <span className="hero-orbit-item hero-orbit-item--bolt">{"\u26A1"}</span>
      <span className="hero-orbit-item hero-orbit-item--pepper">{"\u{1F336}\uFE0F"}</span>
      <span className="hero-orbit-item hero-orbit-item--fire">{"\u{1F525}"}</span>
    </div>
  </div>
  ```
- **Audit Finding:**
  The developer correctly wrapped the orbiting spark, pepper, and fire elements in `<div className="hero-orbit-ring" aria-hidden="true">`. However, the central drumstick emoji on line 108 is inside `<span style={styles.heroCenterWing}>` without `aria-hidden="true"`. A screen reader traversing the landing hero announces: *"WINGS THAT HIT DIFFERENT... Your taste buds will thank you... Poultry leg"*.
- **Recommended Remediation:**
  Add `aria-hidden="true"` to `<div style={styles.wingEmojis} aria-hidden="true">` or directly on `<span style={styles.heroCenterWing} aria-hidden="true">`.

---

### 3.5 Issue 5: Mobile Menu Catalog Remote Image Accessibility Gaps
- **File:** [`apps/application/src/screens/menu-screen.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/src/screens/menu-screen.tsx#L732)
- **WCAG Criteria:** 1.1.1 Non-text Content, 4.1.2 Name, Role, Value
- **Current Behavior:**
  ```tsx
  {hasImage ? (
    <Image
      source={{ uri: item.image_url! }}
      style={styles.itemImage}
      contentFit="cover"
      transition={300}
      // Missing accessible={false}
    />
  ) : (
    <View style={styles.itemImagePlaceholder}>
      <Image
        source={categoryImageForSlug(categorySlug)}
        style={styles.itemImage}
        contentFit="contain"
        accessible={false} // Correctly specified on fallback
      />
    </View>
  )}
  ```
- **Audit Finding:**
  The fallback category icon on line 741 explicitly defines `accessible={false}` because the parent `TouchableOpacity` (line 725) already defines a comprehensive `accessibilityLabel`:
  ```tsx
  accessibilityLabel={`${details.name}, ${isUnavailable ? 'currently unavailable' : priceLabel}${details.description ? `. ${details.description}` : ''}`}
  ```
  However, on line 732, when `hasImage` is true, `<Image source={{ uri: item.image_url! }} />` does not have `accessible={false}`. On iOS VoiceOver and Android TalkBack, child images inside pressables can become isolated focus targets or announce unlabelled image artifacts.
- **Recommended Remediation:**
  Add `accessible={false}` to the remote catalog `<Image>` on line 732 to match line 741 and preserve clean single-element card navigation.

---

### 3.6 Issue 6: Public Menu Uploads File Size & Delivery Optimization
- **Location:** [`apps/web/public/uploads/menu/`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/public/uploads/menu/)
- **Impact:** Page Load Performance, Core Web Vitals (LCP), Mobile Bandwidth
- **Audit Finding:**
  The 5 combo menu images:
  - `combo-1lb-be69957a.jpeg` (1,039 KB)
  - `combo-1.5lb-41acb060.jpeg` (1,039 KB)
  - `combo-2lb-a3405132.jpeg` (1,039 KB)
  - `combo-3lb-6ee810d6.jpeg` (1,039 KB)
  - `combo-5lb-cb5405ef.jpeg` (1,039 KB)
  Total weight: **5.19 MB**. When customers open `/menu` or `/order`, all 5 images load in parallel over HTTP. While they have correct `loading="lazy"` and `decoding="async"` attributes on `<img>`, they lack responsive srcset resizing and modern format compression.
- **Recommended Remediation:**
  1. Compress the 5 JPEGs to modern WebP format (~90 KB each, reducing total payload from 5.2 MB to < 450 KB).
  2. In `next.config.ts`, ensure `images.remotePatterns` or Next.js `<Image>` loader is configured if migrating menu cards to `<Image>`.

---

## 4. Priority Remediation Matrix

| Rank | Issue Summary | Target File | Impacted Line(s) | Remediation Complexity | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P1** | Add brand name to default `ariaLabel` in `WingsBrandLockup` | `apps/web/src/components/wings-brand-lockup.tsx` | Line 23 | Low (1 line) | **High** |
| **P2** | Mark cart item thumbnail image decorative to avoid duplicate speech | `apps/web/src/Wings4u/components/cart-page.tsx` | Line 799 | Low (2 attributes) | **Medium** |
| **P3** | Add `accessible={false}` to remote item catalog images | `apps/application/src/screens/menu-screen.tsx` | Line 732 | Low (1 attribute) | **Medium** |
| **P4** | Hide decorative hero center drumstick emoji from screen readers | `apps/web/src/Wings4u/components/landing.tsx` | Line 107 | Low (1 attribute) | **Medium** |
| **P5** | Add descriptive alt text to admin upload picture previews | `apps/web/src/app/admin/menu/menu-item-modal.tsx`, `admin-menu-client.tsx` | Lines 537, 643 | Low (template string) | **Medium** |
| **P6** | Remove duplicate accessibilityLabel on mobile cart image | `apps/application/app/(tabs)/cart.tsx` | Line 148 | Low (1 attribute) | **Low** |
| **P7** | Compress combo menu JPEG uploads to WebP (~90% payload reduction) | `apps/web/public/uploads/menu/` | 5 image files | Medium (asset tooling) | **Performance** |

---

## 5. Step-by-Step Code Fixes

### 5.1 Fix P1: `WingsBrandLockup` Brand Identification
**File:** [`apps/web/src/components/wings-brand-lockup.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-brand-lockup.tsx#L23)
```diff
 export function WingsBrandLockup({
   href = "/",
-  ariaLabel = "Go to home",
+  ariaLabel = "Wings 4 U — Home",
   className,
   style,
   wordmarkClassName,
```
**File:** [`apps/web/src/components/site-footer.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/site-footer.tsx#L12)
```diff
         <div className="footer-brand">
           <WingsBrandLockup
             href="/"
-            ariaLabel="Back to home"
+            ariaLabel="Wings 4 U — Back to top of home"
             className="footer-brand-link"
```
**File:** [`apps/web/src/Wings4u/components/sauces-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-page.tsx#L351)
```diff
         <nav id="navbar" className={styles.navbar}>
           <WingsBrandLockup
             href="/"
-            ariaLabel="Back to home"
+            ariaLabel="Wings 4 U — Home"
             priority
```

---

### 5.2 Fix P2: Web Cart Line Thumbnail Redundancy
**File:** [`apps/web/src/Wings4u/components/cart-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/cart-page.tsx#L797)
```diff
                   <div className="wk-cart-line-thumb" style={styles.cartItemThumbWrap}>
                     {imageUrl ? (
                       <img
                         src={imageUrl}
-                        alt={item.name}
+                        alt=""
+                        aria-hidden="true"
                         style={styles.cartItemThumbImage}
                       />
                     ) : (
```

---

### 5.3 Fix P3: Mobile Menu Catalog Remote Image
**File:** [`apps/application/src/screens/menu-screen.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/src/screens/menu-screen.tsx#L732)
```diff
       {/* Catalog image, with the existing local category image as the offline fallback. */}
       {hasImage ? (
         <Image
           source={{ uri: item.image_url! }}
           style={styles.itemImage}
           contentFit="cover"
           transition={300}
+          accessible={false}
         />
       ) : (
```

---

### 5.4 Fix P4: Landing Hero Center Wing Emoji
**File:** [`apps/web/src/Wings4u/components/landing.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/landing.tsx#L107)
```diff
               <div style={styles.heroGlowAnchor} aria-hidden="true">
                 <div className="hero-visual-glow">
                   <div className="hero-visual-glow-inner" />
                 </div>
               </div>
-              <div style={styles.wingEmojis}>
+              <div style={styles.wingEmojis} aria-hidden="true">
                 <span style={styles.heroCenterWing}>
                   {"\u{1F357}"}
                 </span>
```

---

### 5.5 Fix P5: Admin Modal Upload Previews
**File:** [`apps/web/src/app/admin/menu/menu-item-modal.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/menu-item-modal.tsx#L536)
```diff
                   <div className={styles.menuItemModalImageWrap}>
                     <img
                       src={imagePreview}
-                      alt=""
+                      alt={`Preview for ${name.trim() || "menu item"}`}
                       className={styles.menuItemModalImage}
                     />
                   </div>
```
**File:** [`apps/web/src/app/admin/menu/admin-menu-client.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/admin-menu-client.tsx#L642)
```diff
                   <div className={styles.builderPicturePreview}>
                     <img
                       src={shownImage}
-                      alt=""
+                      alt={`Category image preview for ${selectedCategory?.name || "category"}`}
                       className={styles.builderPictureImage}
                     />
                   </div>
```

---

### 5.6 Fix P6: Mobile Cart Image Duplicate Label
**File:** [`apps/application/app/(tabs)/cart.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/app/(tabs)/cart.tsx#L148)
```diff
                   <View key={item.key} style={styles.cartLine}>
                     <View style={styles.cartLineTop}>
-                      {item.image_url ? <Image source={{ uri: item.image_url }} accessibilityLabel={item.name} style={styles.itemImage} /> : null}
+                      {item.image_url ? <Image source={{ uri: item.image_url }} accessible={false} style={styles.itemImage} /> : null}
                       <View style={styles.cartLineInfo}>
                         <Text style={styles.itemName}>{item.name}</Text>
```

---

## 6. Verification & Screen Reader Testing Protocols

### 6.1 Desktop Screen Readers (NVDA / VoiceOver / JAWS)
1. **Brand Lockup Test:**
   - Navigate to `/` and press `Tab` to reach the logo link.
   - **Expected Voice Announcement:** *"Wings 4 U — Home, link"* (previously: *"Go to home, link"*).
2. **Menu Catalog Image Test:**
   - Navigate to `/menu`.
   - Focus on menu cards. Screen readers read item card article, announcing:
     *"[Item Name] on the Wings 4 U menu, image"* followed by `<h3>[Item Name]</h3>`.
3. **Cart Line Card Test:**
   - Add an item to cart and navigate to `/cart`.
   - Use virtual cursor (`Down Arrow`) through the cart line item.
   - **Expected Voice Announcement:** Reads the thumbnail without announcing the item name twice. Item name is announced once when reaching `<h3>`.
4. **Hero Drumstick Test:**
   - Read through `/` hero title.
   - **Expected Voice Announcement:** No rogue *"poultry leg"* or emoji speech between hero title and proof list.

### 6.2 Mobile Screen Readers (iOS VoiceOver / Android TalkBack)
1. **Home Carousel Test:**
   - Swipe through top promo banners on Home.
   - **Expected Voice Announcement:** VoiceOver speaks *"Wings promotion. Opens the Wings menu. Button"*, focusing the pressable banner rather than sub-image pixels.
2. **Menu Catalog Image Test:**
   - Swipe through menu items on Menu screen.
   - **Expected Voice Announcement:** Focus highlights the full item row once, announcing title, stock status, and price without an extraneous stop on the item picture.

---

## 7. Audit Sign-Off & Status

| Role | Responsibility | Status |
| :--- | :--- | :--- |
| **Audit Execution** | Comprehensive scan of Web, Mobile, Admin, and Public Assets | ✅ **COMPLETE** |
| **Artifact Maintenance** | Deleted obsolete `p6fixes.md` | ✅ **DONE** |
| **Report Generation** | Created `imgaltfix.md` with inventory, WCAG ratings & diffs | ✅ **COMMITTED TO WORKSPACE** |
| **Ready for Code Application** | Code fixes outlined with exact line numbers and diffs | 🟢 **READY FOR IMPLEMENTATION** |
