# Wings4U Design Theme & Color System Guide

This document captures the complete design theme used across the Menu Page, Cart Page, and Checkout Page. Use this guide to create consistent new pages like Profile Page and Admin Pages.

---

## 🎨 Core Color Palette

### Primary Brand Colors
- **Accent Orange**: `#f5a623` — Primary call-to-action, highlights, active states
- **Dark Base**: `#0a0a0a` — Main background, app container
- **Dark Brown**: `#1a1a1a`, `#333`, `#170f09` — Borders, secondary backgrounds
- **Warm Tan**: `#f8c676` — Cart/Menu panel background (warm accent panel)
- **Cream/Off-White**: `#fff4e6`, `#fff3e3`, `#ffbc00` — Text, labels, card titles

### Text Colors
- **White**: `#fff` — Primary headings, nav text
- **Off-White**: `#fff4e6`, `#fff3e3` — Card text, body content
- **Subdued Gold**: `#ffbc00` — Menu item descriptions
- **Warm Brown**: `#cc8855`, `#5c432f` — Secondary text, descriptions
- **Error Red**: `#ff8a73` — Error messages, removed items

### Transparency Overlays
- `rgba(255,255,255,0.04)` to `rgba(255,255,255,0.12)` — Subtle borders and backgrounds
- `rgba(0,0,0,0.35)` to `rgba(0,0,0,0.8)` — Shadow and modal overlays

---

## 📐 Typography

### Font Families
1. **Headings & Accents**: `'Bebas Neue', sans-serif`
   - Letter spacing: `1` to `6`
   - Font weight: normal
   - For big impact titles and buttons

2. **Body & Labels**: `'DM Sans', sans-serif`
   - Font weight: `600` to `700` for important text
   - Font weight: `400` for body content
   - Regular letter spacing

3. **Display Titles**: `'Black Han Sans', sans-serif`
   - Used sparingly for hero sections

### Font Sizes
- **Large Titles**: `clamp(64px, 10vw, 128px)` (responsive)
- **Section Titles**: `clamp(28px, 3vw, 36px)` (responsive)
- **Card Titles**: `16px` to `18px`
- **Body Text**: `13px` to `16px`
- **Small Text**: `11px` to `13px`
- **Labels**: `11px` to `14px`

### Line Heights
- **Headings**: `0.9` to `1.28`
- **Body**: `1.4` to `1.5`

---

## 🎯 Button Styles

### Primary Button (`.btn-primary`, `.cart-checkout-fire-btn`, `.fire-btn`)
```
Background: #f5a623 (accent orange)
Color: #0a0a0a (dark)
Border: none
Padding: 14px 32px
Font: 'Bebas Neue', 20px, letter-spacing: 2px
Border-radius: 4px
Cursor: pointer
Transition: transform 0.2s, opacity 0.2s
Hover: darker orange, transform scale
Disabled: opacity 0.5, cursor not-allowed
```

### Secondary Button
```
Background: transparent
Color: #fff (white) or #f5a623 (orange)
Border: 2px solid #fff or 1px solid #333
Padding: 14px 32px
Font: 'Bebas Neue', 20px, letter-spacing: 2px
Border-radius: 4px
Transition: all 0.2s
```

### Small Action Buttons
```
Background: rgba(255,255,255,0.04) or transparent
Color: #fff4e6
Border: 1px solid rgba(255,255,255,0.12)
Padding: 8px 24px or clamp(8px, 1.3svh, 9px)
Font: 'Bebas Neue', 13-14px, letter-spacing: 1-1.2px
Border-radius: 4px
Cursor: pointer
Transition: all 0.2s
```

### Active/Hover State
```
Background: #f5a623
Color: #0a0a0a
Border-color: #f5a623
```

---

## 🎨 Card Styling

### Menu Card
```
Background: linear-gradient(180deg, rgba(37,31,26,0.98) 0%, rgba(25,21,18,0.98) 100%)
Border: 1px solid rgba(255, 232, 197, 0.12)
Border-radius: 0 (sharp corners)
Padding: clamp(12px, 1.7svh, 14px) + content padding
Box-shadow: 0 14px 26px rgba(23, 18, 13, 0.2), inset 0 1px 0 rgba(255,255,255,0.03)
Min-height: clamp(210px, 27svh, 294px)
Transition: box-shadow 0.22s, border-color 0.22s
```

### Cart Card (`.cartCard`, `.surface-card`)
```
Background: linear-gradient(180deg, rgba(37,31,26,0.98) 0%, rgba(25,21,18,0.98) 100%)
           OR: rgba(25, 21, 18, 0.6) semi-transparent
Border: 1px solid rgba(255, 232, 197, 0.12)
Border-radius: 6-12px
Padding: clamp(18px, 2vw, 26px)
Box-shadow: 0 14px 26px rgba(23, 18, 13, 0.2), inset 0 1px 0 rgba(255,255,255,0.03)
Color: #fff4e6 (warm cream text)
```

### Panel/Surface Card Background
```
Background: rgba(25, 21, 18, 0.6) with semi-transparency
Border: 1px solid rgba(255, 255, 255, 0.1) subtle border
Border-radius: 8-12px
Padding: appropriate spacing (1rem to 2rem)
```

---

## 📝 Form Field Styling

### Checkout Field (`.checkout-field`)
```
Margin-bottom: 0.75rem
```

### Checkout Field Label
```
Display: block
Font-size: 0.875rem (14px)
Font-weight: 600
Margin-bottom: 0.25rem
Color: #fff or #fff4e6
```

### Checkout Field Input/Textarea/Select
```
Display: block
Width: 100%
Box-sizing: border-box
Padding: 0.625rem 0.75rem (10px 12px)
Border: 1px solid rgba(255, 255, 255, 0.2)
Background: rgba(10, 10, 10, 0.3) (very dark, semi-transparent)
Color: #fff
Border-radius: 4px
Font: 'DM Sans', 1rem
Font-size: 0.875rem to 1rem
Transition: border-color 0.2s
```

### Input Focus State
```
Border-color: #f5a623 or rgba(255, 166, 35, 0.5)
Outline: none
Background: rgba(10, 10, 10, 0.4)
```

### Textarea
```
Resize: vertical
Min-height: 3rem (minimum visible lines)
```

---

## 🌍 Page Layout Structure

### Main App Background (`.app`)
```
Background: #0a0a0a (solid dark base)
Background-image: 
  radial-gradient(circle at 50% 50%, rgba(255,100,0,0.21) 1px, transparent 1.85px),
  radial-gradient(circle at 50% 50%, rgba(255,92,0,0.09) 0px, transparent 9.6px),
  radial-gradient(circle at 50% 50%, rgba(255,170,40,0.04) 0px, transparent 13.5px)
Background-size: 40px 40px
(Creates subtle orange dotted/radial texture overlay)
Min-height: 100vh
Display: flex
Flex-direction: column
Width: 100%
Font-family: 'DM Sans', sans-serif
Color: #fff
```

### Page Container (`.menuPage`, `.cartMenuSurface`)
```
Max-width: min(1720px, 100%)
Margin: 0 auto
Box-sizing: border-box
Padding: 0 clamp(0.75rem, 2.5vw, 3rem) clamp(1.25rem, 2vw, 2rem) to 4rem bottom
Border-radius: 0 0 32px 32px (for menu/cart surfaces)
Overflow: visible
```

### Warm Panel (Menu/Cart Surface `.menuSurface`)
```
Background: #f8c676 (warm tan/sand color)
Border: 1px solid rgba(255,255,255,0.28)
Box-shadow: 0 26px 70px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)
Border-radius: 0 0 32px 32px
```

---

## 🧭 Navigation & Header

### Nav Bar (`.nav`)
```
Display: flex
Justify-content: space-between
Align-items: center
Padding: 0.35rem 1.5rem
Background: rgba(10,10,10,0.97) (slightly transparent dark)
Backdrop-filter: blur(14px)
Position: sticky
Top: 0
Z-index: 999
Border-bottom: 1px solid #1a1a1a
```

### Brand Name (`.navBrand`)
```
Font-family: 'Bebas Neue', sans-serif
Font-size: 30px
Letter-spacing: 1px
Color: #fff
```

### Brand Accent (`.navBrandAccent`)
```
Color: #f5a623
```

---

## 🔲 Status & Messages

### Error Message (`.surface-error`)
```
Background: rgba(255, 138, 115, 0.1) or transparent
Color: #ff8a73 (error red)
Border: optional 1px solid rgba(255, 138, 115, 0.3)
Padding: 0.75rem
Border-radius: 4-6px
Font-size: 14px
```

### Shipping/Removed Items Color
```
Color: #ff8a73 (same error red)
Font-size: 12px
Margin: 4px 0 0 0
Line-height: 1.4
```

---

## 💡 Key Design Patterns

### 1. Responsive Sizing
Use `clamp()` for responsive values:
- `clamp(min, preferred, max)` — automatically scales between min and max
- Example: `clamp(228px, 19vw, 272px)` for grid columns
- Avoids media queries for most spacing and sizing

### 2. Visual Hierarchy
- **Large accent orange** for primary actions
- **Warm cream/tan** for readable body text on dark backgrounds
- **Subtle borders** with `rgba(255,255,255,0.06)` to `rgba(255,255,255,0.12)`
- **Drop shadows** for depth: `0 14px 26px rgba(23, 18, 13, 0.2)`

### 3. Spacing
- **Small gaps**: `4px` to `10px`
- **Medium gaps**: `12px` to `18px`
- **Large gaps**: `24px` to `32px`
- **Page padding**: `clamp()` values for responsive horizontal padding

### 4. Transitions
- **Fast interactions**: `0.2s`
- **Slower transitions**: `0.22s` to `0.9s`
- **Easing**: `cubic-bezier(0.23,1,0.32,1)` for snappy motion

### 5. Border Radius
- **Sharp corners**: `0` (menu cards)
- **Subtle rounding**: `4px` (buttons, small elements)
- **Rounded panels**: `6px` to `12px` (cards, modals)
- **Large rounding**: `32px` (page sections)

---

## 📊 Grid & Layout

### Menu Grid
```
Display: grid
Grid-template-columns: repeat(auto-fill, minmax(min(clamp(228px, 19vw, 272px), 100%), 1fr))
Gap: clamp(12px, 1.4vw, 16px)
Justify-content: center
Align-items: stretch
Width: 100%
```

### Cart Layout
```
Display: flex
Justify-content: center
Max-width: 760px (for cart items column)

Two-column checkout:
- Left: order details
- Right: summary + form fields
```

---

## 🎬 Animations & Effects

### Hover Effects
- **Buttons**: `transform 0.2s` (slight scale up)
- **Cards**: `box-shadow 0.22s, border-color 0.22s`
- **Links**: color transition `0.2s`

### Text Styling
- **Active/emphasis**: color `#f5a623`
- **Secondary text**: `rgba(255, 244, 230, 0.72)` or `rgba(255, 244, 230, 0.6)`
- **Subtle text**: `rgba(255, 244, 230, 0.5)`

### Filter Buttons
```
Border: 1px solid #333
Color: #888 (muted)
Transition: all 0.2s

Active state:
Border-color: #f5a623
Color: #f5a623
```

---

## 📱 Responsive Breakpoints

The design uses `clamp()` instead of traditional media queries, making it fluid from mobile to desktop. Key responsive values:

- **Padding/Margins**: `clamp(0.75rem, 2vw, 3rem)`
- **Font sizes**: `clamp(13px, 1.52svh, 15px)` (using `svh` for viewport height)
- **Grid columns**: `repeat(auto-fill, minmax(min(clamp(228px, 19vw, 272px), 100%), 1fr))`
- **Gaps**: `clamp(12px, 1.4vw, 16px)`

---

## 🎯 For AI Agent: Generate Profile & Admin Pages

When creating new pages, follow this pattern:

1. **Container**: Use `.surface-card` or `cartCard` styles for page sections
2. **Headings**: Use `'Bebas Neue'` with `#fff` color
3. **Body text**: Use `'DM Sans'` with `#fff4e6` color
4. **Primary buttons**: Orange `#f5a623` background, dark text
5. **Form fields**: Dark semi-transparent backgrounds, subtle borders, cream text
6. **Error messages**: Red `#ff8a73` text
7. **Spacing**: Use `clamp()` for responsive spacing
8. **Shadows**: `0 14px 26px rgba(23, 18, 13, 0.2)` for depth
9. **Backgrounds**: Dark gradient or semi-transparent dark with subtle orange dot texture
10. **Accent colors**: `#f5a623` for interactive elements

---

## 🖼️ Visual Examples

### Profile Page Structure (suggested)
```
┌─────────────────────────────────────┐
│  Nav Bar                        Cart │
├─────────────────────────────────────┤
│  Back Link                          │
│  PROFILE                            │
│  Your Name Here                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ Full Name                       │ │
│ │ [input field]                   │ │
│ │                                 │ │
│ │ Email (optional)                │ │
│ │ [input field]                   │ │
│ │                                 │ │
│ │ Phone                           │ │
│ │ [read-only field]               │ │
│ │                                 │ │
│ │ [SAVE CHANGES]                  │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Admin Dashboard Structure (suggested)
```
┌─────────────────────────────────────────────┐
│  Nav Bar                            Profile  │
├─────────────────────────────────────────────┤
│  ADMIN DASHBOARD                            │
├─────────────────────────────────────────────┤
│  ┌──────────┬──────────┬──────────┐         │
│  │ Orders   │ Menu     │ Settings │         │
│  └──────────┴──────────┴──────────┘         │
├─────────────────────────────────────────────┤
│ ┌────────────────┬────────────────────────┐ │
│ │ Recent Orders  │ Quick Stats            │ │
│ │                │ • Total Orders: 45     │ │
│ │ [Order list]   │ • This Week: 12        │ │
│ │                │ • Pending: 3           │ │
│ └────────────────┴────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## ✅ Checklist for New Pages

- [ ] Use `#0a0a0a` background with orange dot texture overlay
- [ ] Headings in `'Bebas Neue'` with proper letter-spacing
- [ ] Body text in `'DM Sans'` with `#fff4e6` color
- [ ] Primary buttons in orange `#f5a623`
- [ ] Form fields with dark semi-transparent backgrounds
- [ ] Use `clamp()` for responsive sizing
- [ ] Add subtle shadows: `0 14px 26px rgba(23, 18, 13, 0.2)`
- [ ] Border-radius: `4px` for buttons, `6-12px` for cards
- [ ] Borders: `1px solid rgba(255, 232, 197, 0.12)` or similar
- [ ] Transitions: `0.2s` for interactions
- [ ] Error text in red `#ff8a73`
- [ ] Test on mobile, tablet, and desktop

---

End of Design Guide. Use this for consistent styling across all new pages.
