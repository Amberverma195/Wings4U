# Accessibility & Implementation Fixes Report (`imgaltfixed.md`)

**Date:** 2026-10-23  
**Target Codebase:** Wings4U Multi-Platform Repository (`apps/web`, `apps/application`)  
**Standard Alignment:**  
- **WCAG 2.1 Success Criterion 1.1.1 Non-text Content (Level A)**
- **WCAG 2.1 Success Criterion 2.1.1 Keyboard Navigation (Level A)**
- **WCAG 2.1 Success Criterion 2.4.4 Link Purpose (In Context) (Level A)**
- **WCAG 2.1 Success Criterion 4.1.2 Name, Role, Value (Level A)**
- **W3C ARIA Authoring Practices Guide (APG) — Tabs Pattern**
- **W3C WAI Images Guidelines** (Informative, Decorative, Functional, and Non-Redundant)  
**Status:** 🟢 **ALL FIXES APPLIED & VERIFIED LOCALLY — NO COMMITS / PUSHES EXECUTED**

---

## 1. Executive Summary

This report documents the resolution of all accessibility and environment issues across the Wings4U codebase, encompassing:
1. **The image alt text audit findings** ([`imgaltfix.md`](./imgaltfix.md)) across web, backoffice, and mobile surfaces.
2. **P2 Issue A:** Correction of the fallback Privacy Policy URL in the mobile application from `wings4u.ca` to the actual production website `https://www.wings4ulondon.ca/privacy`, along with regression test strengthening.
3. **P2 Issue B:** Completion of the W3C Tabs Pattern keyboard behavior in [`builder-shared.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/builder-shared.tsx) (bidirectional arrow key navigation, `id`/`aria-controls` tab-to-panel associations, `tabIndex` focus management) and cleanup of redundant `aria-pressed` attributes from `role="radio"` flavour options.

---

## 2. Complete Inventory of Modified Files

| # | File Path | Surface | Issue Addressed | Type of Change |
| :- | :--- | :--- | :--- | :--- |
| **1** | [`apps/web/src/components/wings-brand-lockup.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/wings-brand-lockup.tsx) | Global Web Shell | P1: Brand name omission in default link `ariaLabel` | Changed default to `"Wings 4 U — Home"` |
| **2** | [`apps/web/src/components/site-footer.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/site-footer.tsx) | Site Footer | P1: Footer brand lockup link label | Changed `ariaLabel` to `"Wings 4 U — Back to home"` |
| **3** | [`apps/web/src/Wings4u/components/sauces-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-page.tsx) | Sauces Navbar & Footer | P1: Sauces page brand link labels | Changed `ariaLabel` to `"Wings 4 U — Home"` in header and footer |
| **4** | [`apps/web/src/Wings4u/components/sauces-skeleton.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/sauces-skeleton.tsx) | Sauces Loading Skeleton | P1: Skeleton brand link label | Changed `ariaLabel` to `"Wings 4 U — Home"` |
| **5** | [`apps/web/src/Wings4u/components/cart-page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/cart-page.tsx) | Customer Cart (Web) | P2: Duplicate name announcement before `<h3>` | Set `alt=""` and `aria-hidden="true"` on thumbnail `<img>` |
| **6** | [`apps/web/src/Wings4u/components/landing.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/Wings4u/components/landing.tsx) | Homepage Landing Hero | P4: Raw chicken leg emoji announced as "poultry leg" | Added `aria-hidden="true"` to `wingEmojis` wrapper |
| **7** | [`apps/web/src/app/admin/menu/menu-item-modal.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/menu-item-modal.tsx) | Admin Menu Management | P5: Empty alt in active image upload preview | Set `alt={`Preview for ${name.trim() \|\| "menu item"}`}` |
| **8** | [`apps/web/src/app/admin/menu/admin-menu-client.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/admin/menu/admin-menu-client.tsx) | Admin Builder Management | P5: Empty alt in category picture preview | Set `alt={`Category image preview for ${selectedCategory?.name \|\| "category"}`}` |
| **9** | [`apps/web/src/app/account/profile/page.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/app/account/profile/page.tsx) | Account Profile | Polish: Internal SVG node traversal in `role="img"` | Added `aria-hidden="true"` to inner `<svg>` |
| **10** | [`apps/web/src/components/builder-shared.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/src/components/builder-shared.tsx) | Wing & Combo Builders | P2 Issue B: Incomplete tab keyboard navigation & redundant `aria-pressed` | Added arrow key navigation (`ArrowRight`, `ArrowLeft`, `Home`, `End`), `role="tabpanel"`, `aria-controls`, and removed `aria-pressed` from radios |
| **11** | [`apps/web/tests/web-a11y-semantics.test.cjs`](file:///d:/Projects/Websites/Wings4U/Code/apps/web/tests/web-a11y-semantics.test.cjs) | Web Accessibility Tests | P2 Issue B: Validation of tabs pattern and radio attributes | Updated assertions to test arrow navigation, tabpanel IDs, and absence of `aria-pressed` |
| **12** | [`apps/application/src/screens/menu-screen.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/src/screens/menu-screen.tsx) | Menu Screen (Mobile) | P3: Unlabelled remote catalog image inside pressable | Added `accessible={false}` to catalog `<Image>` |
| **13** | [`apps/application/app/(tabs)/cart.tsx`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/app/(tabs)/cart.tsx) | Cart Tab (Mobile) | P6: Redundant accessibility label on line image | Changed `accessibilityLabel={item.name}` to `accessible={false}` |
| **14** | [`apps/application/src/lib/env.ts`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/src/lib/env.ts) | Mobile Environment Lib | P2 Issue A: Incorrect fallback privacy policy URL | Corrected fallback to `https://www.wings4ulondon.ca/privacy` |
| **15** | [`apps/application/tests/mobile-env.test.cjs`](file:///d:/Projects/Websites/Wings4U/Code/apps/application/tests/mobile-env.test.cjs) | Mobile Env Unit Tests | P2 Issue A: Regression test domain verification | Added tests verifying `wings4ulondon.ca` domain derivation and fallback |

---

## 3. Code Diffs and Architectural Explanations

### 3.1 P2 Issue A: Privacy Policy URL Fallback Correction

#### `apps/application/src/lib/env.ts`
```diff
     if (url.hostname.startsWith("api.")) {
       url.hostname = url.hostname.slice(4);
       url.pathname = "/privacy";
       return url.toString();
     }
     return `${apiBase.replace(/\/$/, "")}/privacy`;
   } catch {
-    return "https://wings4u.ca/privacy";
+    return "https://www.wings4ulondon.ca/privacy";
   }
 }
```
**Rationale:**  
The production web platform domain is `wings4ulondon.ca` (not `wings4u.ca`). If configuration lookup fails or if `getApiBase()` throws, the fallback must safely point to the authentic live domain `https://www.wings4ulondon.ca/privacy`.

#### `apps/application/tests/mobile-env.test.cjs`
```diff
+test('getPrivacyPolicyUrl derives the wings4ulondon.ca website domain from the api subdomain', () => {
+  global.__DEV__ = false;
+  mockExtra = { environment: 'production', apiOrigin: 'https://api.wings4ulondon.ca' };
+  const url = getPrivacyPolicyUrl();
+  expect(url).toBe('https://wings4ulondon.ca/privacy');
+  expect(new URL(url).hostname).toBe('wings4ulondon.ca');
+  expect(new URL(url).pathname).toBe('/privacy');
+});
+
+test('getPrivacyPolicyUrl falls back to https://www.wings4ulondon.ca/privacy on lookup failure', () => {
+  global.__DEV__ = false;
+  mockExtra = { environment: 'production' }; // getApiBase throws because apiOrigin is not configured
+  const url = getPrivacyPolicyUrl();
+  expect(url).toBe('https://www.wings4ulondon.ca/privacy');
+  expect(new URL(url).hostname).toBe('www.wings4ulondon.ca');
+  expect(new URL(url).pathname).toBe('/privacy');
+});
+
+test('getPrivacyPolicyUrl derives from explicit websiteUrl or privacyPolicyUrl with wings4ulondon.ca', () => {
+  mockExtra = { websiteUrl: 'https://www.wings4ulondon.ca' };
+  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');
+
+  mockExtra = { privacyPolicyUrl: 'https://www.wings4ulondon.ca/legal/privacy' };
+  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/legal/privacy');
+});
```

---

### 3.2 P2 Issue B: Builder Tab Keyboard Behavior & Redundant ARIA Clean-up

#### `apps/web/src/components/builder-shared.tsx` (`FlavourPicker` & `ExtraFlavourPicker`)
```diff
+  const baseId = useId();
+  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
+
+  const activeIndex = grouped.findIndex((group) => group.level === activeHeat);
+  const currentActiveIndex = activeIndex >= 0 ? activeIndex : 0;
+  const activeGroup = grouped[currentActiveIndex] ?? grouped[0];
+
+  const handleTabKeyDown = (
+    event: React.KeyboardEvent<HTMLButtonElement>,
+    index: number,
+  ) => {
+    if (grouped.length <= 1) return;
+    let nextIndex: number | null = null;
+
+    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
+      event.preventDefault();
+      nextIndex = (index + 1) % grouped.length;
+    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
+      event.preventDefault();
+      nextIndex = (index - 1 + grouped.length) % grouped.length;
+    } else if (event.key === "Home") {
+      event.preventDefault();
+      nextIndex = 0;
+    } else if (event.key === "End") {
+      event.preventDefault();
+      nextIndex = grouped.length - 1;
+    }
+
+    if (nextIndex !== null) {
+      const nextGroup = grouped[nextIndex];
+      if (nextGroup) {
+        setActiveHeat(nextGroup.level);
+        tabsRef.current[nextIndex]?.focus();
+      }
+    }
+  };
+
+  const getTabId = (level: string) =>
+    `flavour-tab-${baseId}-${level.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
+  const getPanelId = (level: string) =>
+    `flavour-panel-${baseId}-${level.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

   return (
     <div className="builder-flavour-picker">
       <div className="builder-heat-tabs" role="tablist" aria-label="Flavour heat levels">
-        {grouped.map((group) => (
+        {grouped.map((group, idx) => {
+          const isSelected = group.level === activeHeat;
+          return (
             <button
               key={group.level}
+              ref={(el) => { tabsRef.current[idx] = el; }}
+              id={getTabId(group.level)}
               type="button"
               role="tab"
-              aria-selected={group.level === activeHeat}
-              className={`builder-heat-tab${group.level === activeHeat ? " builder-heat-tab-active" : ""}`}
+              aria-selected={isSelected}
+              aria-controls={getPanelId(group.level)}
+              tabIndex={isSelected ? 0 : -1}
+              className={`builder-heat-tab${isSelected ? " builder-heat-tab-active" : ""}`}
               onClick={() => setActiveHeat(group.level)}
+              onKeyDown={(e) => handleTabKeyDown(e, idx)}
               disabled={disabled}
             >
               {group.level.replace(/_/g, " ")}
             </button>
-        ))}
+          );
+        })}
       </div>

-      <div className="builder-flavour-pills" role="radiogroup" aria-label={`${activeGroup?.level.replace(/_/g, " ")} flavours`}>
+      <div
+        id={getPanelId(activeGroup?.level ?? "")}
+        role="tabpanel"
+        aria-labelledby={getTabId(activeGroup?.level ?? "")}
+        className="builder-heat-tabpanel"
+        tabIndex={0}
+      >
+        <div
+          className="builder-flavour-pills"
+          role="radiogroup"
+          aria-label={`${activeGroup?.level.replace(/_/g, " ")} flavours`}
+        >
           {activeGroup?.items.map((flavour) => (
             <button
               key={flavour.id}
               type="button"
               role="radio"
               aria-checked={flavour.id === selectedFlavourId}
-              aria-pressed={flavour.id === selectedFlavourId}
               className={`builder-flavour-pill${flavour.id === selectedFlavourId ? " builder-flavour-pill-active" : ""}`}
               onClick={() => onSelect(flavour)}
               disabled={disabled}
             >
               {flavour.name}
             </button>
           ))}
         </div>
       </div>
     </div>
   );
```
**Rationale:**  
1. **W3C Tabs Pattern Compliance:**
   - Tabs are interactive controls inside a `role="tablist"`. Each tab has a deterministic `id`, `aria-selected`, `aria-controls` referencing its associated tabpanel, and roving `tabIndex` (`0` for the active tab, `-1` for inactive tabs).
   - Arrow keys (`ArrowRight`, `ArrowDown`, `ArrowLeft`, `ArrowUp`, `Home`, `End`) cycle through heat groups, wrap cyclically, auto-activate the new tab, and focus the DOM element.
   - The panel has `role="tabpanel"`, `id`, `aria-labelledby` referencing the active tab, and `tabIndex={0}`.
2. **MDN & ARIA Spec Conformity for Radios:**
   - Radios inside the `radiogroup` represent mutually exclusive choices and properly communicate their state with `aria-checked`.
   - `aria-pressed` is reserved exclusively for two-state toggle buttons (`button` with on/off states). Applying `aria-pressed` to `role="radio"` is invalid and confuses screen readers. It has been removed.

#### `apps/web/tests/web-a11y-semantics.test.cjs`
```diff
-  test('FlavourPicker has compliant tablist tabs and radiogroup flavour options', async () => {
+  test('FlavourPicker has compliant tablist tabs, tabpanel associations, arrow navigation, and radio options', async () => {
...
     expect(tabs[0].props['aria-selected']).toBe(true);
+    expect(tabs[0].props.tabIndex).toBe(0);
     expect(tabs[1].props['aria-selected']).toBe(false);
+    expect(tabs[1].props.tabIndex).toBe(-1);
+
+    // Tabpanel relationship
+    const tabpanel = root.findByProps({ role: 'tabpanel' });
+    expect(tabpanel).toBeTruthy();
+    expect(tabpanel.props['aria-labelledby']).toBe(tabs[0].props.id);
+    expect(tabs[0].props['aria-controls']).toBe(tabpanel.props.id);
+
+    // Arrow navigation
+    const preventDefault = jest.fn();
+    await act(async () => {
+      tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault });
+    });
+    expect(preventDefault).toHaveBeenCalled();
+    const updatedTabs = tablist.findAllByProps({ role: 'tab' });
+    expect(updatedTabs[1].props['aria-selected']).toBe(true);
+    expect(updatedTabs[1].props.tabIndex).toBe(0);
+
+    // Radio options inside tabpanel
     const radioButtons = radiogroup.findAllByProps({ role: 'radio' });
-    expect(radioButtons[0].props['aria-pressed']).toBe(true);
-    expect(radioButtons[1].props['aria-pressed']).toBe(false);
+    expect(radioButtons[0].props['aria-checked']).toBe(false);
+    expect(radioButtons[0].props['aria-pressed']).toBeUndefined();
```

---

### 3.3 Image Alt Text Audits (P1 – P6 from `imgaltfix.md`)

- **P1 Brand Link Name (`wings-brand-lockup.tsx`, `site-footer.tsx`, `sauces-page.tsx`, `sauces-skeleton.tsx`):**  
  Changed default `ariaLabel` to `"Wings 4 U — Home"` so that screen readers announce the organization name rather than generic "Go to home".
- **P2 & P6 Cart Line Thumbnail Redundancy (`cart-page.tsx`, mobile `cart.tsx`):**  
  Marked thumbnails with `alt="" aria-hidden="true"` (web) and `accessible={false}` (mobile) to prevent speaking item names twice before adjacent `<h3>` / `<Text>`.
- **P3 Mobile Menu Catalog Image (`menu-screen.tsx`):**  
  Added `accessible={false}` to catalog item images inside pressables, unifying the touch target with the card's accessible description.
- **P4 Decorative Hero Drumstick Emoji (`landing.tsx`):**  
  Wrapped `wingEmojis` in `aria-hidden="true"`, preventing screen readers from speaking `"poultry leg"`.
- **P5 Admin Modal Upload Previews (`menu-item-modal.tsx`, `admin-menu-client.tsx`):**  
  Added dynamic `alt={`Preview for ${name.trim() \|\| "menu item"}`}` and `alt={`Category image preview for ${selectedCategory?.name \|\| "category"}`}`.
- **Profile Stamp Progress Ring SVG (`profile/page.tsx`):**  
  Added `aria-hidden="true"` to `<svg>` inside `<div className={styles.progressRing} role="img">`.

---

## 4. Verification and Test Execution Summary

### 4.1 Automated Test Execution Results

```text
======================================================================
1. Web Application Test Suites (apps/web):
   Command: npm --prefix apps/web test
   Result:  PASS (33 test suites, 240 tests passed, 0 failed)

2. Mobile Application Test Suites (apps/application):
   Command: npx jest (in apps/application)
   Result:  PASS (68 test suites, 1055 tests passed, 0 failed)

3. Mobile Environment Unit Tests (apps/application):
   Command: npx jest tests/mobile-env.test.cjs
   Result:  PASS (14 tests passed, including wings4ulondon.ca domain verification)

4. Web Accessibility Semantics Tests (apps/web):
   Command: npx jest tests/web-a11y-semantics.test.cjs
   Result:  PASS (6 tests passed, including W3C tabs pattern & radio ARIA tests)
======================================================================
```

### 4.2 Git Working Tree State

```text
Changes not staged for commit:
  M apps/application/app/(tabs)/cart.tsx
  M apps/application/src/lib/env.ts
  M apps/application/src/screens/menu-screen.tsx
  M apps/application/tests/mobile-env.test.cjs
  M apps/web/src/Wings4u/components/cart-page.tsx
  M apps/web/src/Wings4u/components/landing.tsx
  M apps/web/src/Wings4u/components/sauces-page.tsx
  M apps/web/src/Wings4u/components/sauces-skeleton.tsx
  M apps/web/src/app/account/profile/page.tsx
  M apps/web/src/app/admin/menu/admin-menu-client.tsx
  M apps/web/src/app/admin/menu/menu-item-modal.tsx
  M apps/web/src/components/builder-shared.tsx
  M apps/web/src/components/site-footer.tsx
  M apps/web/src/components/wings-brand-lockup.tsx
  M apps/web/tests/web-a11y-semantics.test.cjs

Untracked files:
  imgaltfix.md
  imgaltfixed.md
```

> [!IMPORTANT]
> - **NO commits have been created.**
> - **NO changes have been pushed to Git remotes.**
> All changes are present in the local working tree ready for review.
