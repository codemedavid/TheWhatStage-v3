# WhatStage Design System

## 1. Visual Theme & Atmosphere

WhatStage is a light-first workspace — clean, precise, and effortlessly readable. The interface rests on warm white and soft gray surfaces that let content breathe, while a saturated emerald green (`#059669`) provides the singular accent thread that ties every interactive element together. The overall feel is closer to Notion or Linear than a traditional SaaS dashboard: generous whitespace, restrained color, sharp typography, and absolute clarity about what is clickable and what is static.

The design avoids the clinical feel of pure white (#FFFFFF everywhere) by introducing a barely-tinted page background (`#F9FAFB`) and slightly warm card surfaces (`#FFFFFF` with fine `#E5E7EB` borders). Depth is conveyed through subtle shadow stacks rather than heavy borders. The result is a workspace that feels calm under heavy data load — pipeline boards, message threads, and analytics all share the same visual quietness.

**Key Characteristics:**
- Light-first with warm off-white page background (`#F9FAFB`)
- White card surfaces with fine gray borders (`#E5E7EB`)
- Emerald Green (`#059669`) as the singular accent — buttons, links, active states, focus rings
- Zinc-based neutral scale for text hierarchy — `#111827` to `#9CA3AF`
- Full-pill buttons (9999px radius) for primary CTAs
- Subtle multi-layer shadow stack for elevation — no heavy drop shadows
- Typography uses system font stack with `ss03` OpenType feature for refined letter shapes

## 2. Color Palette & Roles

### Primary

- **Ink** (`#111827`): Primary text, headings, high-contrast labels (gray-900)
- **Body** (`#374151`): Standard body text, descriptions (gray-700)

### Accent

- **Emerald** (`#059669`): The signature accent — buttons, links, active nav indicators, toggle-on states (emerald-600)
- **Emerald Light** (`#D1FAE5`): Accent backgrounds, success badges, soft highlight washes (emerald-100)
- **Emerald Subtle** (`rgba(5, 150, 105, 0.08)`): Hover backgrounds on accent-adjacent surfaces
- **Focus Ring** (`#34D399`): Keyboard focus outlines — slightly brighter emerald for visibility (emerald-400)

### Surface & Background

- **Page** (`#F9FAFB`): Root page background — barely warm off-white (gray-50)
- **Card** (`#FFFFFF`): Card surfaces, modals, dropdowns, input backgrounds
- **Sidebar** (`#FFFFFF`): Navigation sidebar background
- **Elevated** (`#FFFFFF`): Modals, popovers — same white, distinguished by shadow

### Border & Divider

- **Border** (`#E5E7EB`): Standard card borders, input borders, dividers (gray-200)
- **Border Subtle** (`#F3F4F6`): Faint dividers within cards, table row separators (gray-100)
- **Border Strong** (`#D1D5DB`): Emphasized borders, active input outlines (gray-300)

### Neutrals & Text (Zinc/Gray Scale)

- **Primary** (`#111827`): Headings, important labels (gray-900)
- **Secondary** (`#374151`): Body text, descriptions (gray-700)
- **Tertiary** (`#6B7280`): Metadata, timestamps, helper text (gray-500)
- **Muted** (`#9CA3AF`): Placeholder text, disabled states (gray-400)
- **Faint** (`#D1D5DB`): Decorative elements, disabled borders (gray-300)

### Semantic

- **Success** (`#059669` / `#D1FAE5`): Positive states — published, connected, active
- **Warning** (`#D97706` / `#FEF3C7`): Caution states — draft, pending
- **Danger** (`#DC2626` / `#FEE2E2`): Destructive actions — delete, disconnect, errors
- **Info** (`#2563EB` / `#DBEAFE`): Informational badges, links to docs

## 3. Typography Rules

### Font Family

**Primary:** System font stack with `ss03` OpenType feature
- `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- OpenType features: `ss03` where supported
- This gives native-quality rendering on every platform with zero font-loading cost

**Mono:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`

### Dashboard Hierarchy

| Role | Size | Weight | Color | Use |
|------|------|--------|-------|-----|
| Page Title | 24px | 600 | `#111827` | One per page — "Leads", "Settings" |
| Section Heading | 14px | 500 | `#6B7280` | Card headers — "Recent Activity", "Pipeline" |
| Stat Number | 32px | 300 | `#111827` | Large metric values |
| Stat Label | 14px | 400 | `#6B7280` | Below stat numbers |
| Body | 14px | 400 | `#374151` | Standard text, descriptions |
| Body Medium | 14px | 500 | `#111827` | Emphasized body — names, labels |
| Caption | 12px | 400 | `#6B7280` | Timestamps, metadata |
| Badge Text | 12px | 500 | varies | Inside badge components |
| Button | 14px | 500 | varies | Button labels |
| Input | 14px | 400 | `#111827` | Form inputs |
| Placeholder | 14px | 400 | `#9CA3AF` | Input placeholders |
| Nav Link | 14px | 500 | `#374151` | Sidebar navigation items |
| Nav Link Active | 14px | 600 | `#059669` | Active sidebar item |

### Principles

Dashboard typography is compact and functional. Everything lives at 12-14px with weight doing the heavy lifting for hierarchy, not size. Page titles at 24px/600 are the only large text. The `ss03` feature is maintained from the landing pages for visual consistency across the product. No decorative typography — every text element earns its space by communicating something the user needs.

## 4. Component Stylings

### Buttons

**Primary (Emerald Fill)**
- Background: `#059669`
- Text: White (`#FFFFFF`)
- Border: none
- Border radius: full pill (9999px)
- Padding: 8px 20px
- Hover: `#047857` (emerald-700)
- Focus: `0 0 0 2px #FFFFFF, 0 0 0 4px #34D399` (double ring)
- Transition: background-color 150ms ease

**Secondary (Outlined)**
- Background: transparent
- Text: `#374151` (gray-700)
- Border: 1px solid `#D1D5DB` (gray-300)
- Border radius: full pill (9999px)
- Padding: 8px 20px
- Hover: background `#F9FAFB`
- Focus: same double ring as primary

**Ghost**
- Background: transparent
- Text: `#6B7280` (gray-500)
- Border: none
- Padding: 8px 12px
- Hover: background `#F3F4F6`

**Danger**
- Background: transparent
- Text: `#DC2626`
- Border: 1px solid `#FCA5A5`
- Hover: background `#FEE2E2`, text `#B91C1C`

### Cards & Containers

- Background: White (`#FFFFFF`)
- Border: 1px solid `#E5E7EB`
- Border radius: 12px
- Shadow (resting): `0 1px 2px rgba(0,0,0,0.05)`
- Shadow (hover/elevated): `0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)`
- No inset shadows on light theme — depth comes from border + shadow only
- Transition: box-shadow 200ms ease

### Inputs & Forms

- Background: White (`#FFFFFF`)
- Text: `#111827`
- Border: 1px solid `#D1D5DB`
- Border radius: 8px
- Padding: 8px 12px
- Focus: border `#059669`, ring `0 0 0 3px rgba(5, 150, 105, 0.15)`
- Placeholder: `#9CA3AF`

### Navigation (Dashboard Sidebar)

- Background: White (`#FFFFFF`)
- Border-right: 1px solid `#E5E7EB`
- Width: 224px (w-56)
- Nav items: 14px/500, `#374151`, padding 8px 12px, rounded-lg (8px)
- Active item: text `#059669`, background `rgba(5, 150, 105, 0.08)`, left border 3px `#059669`
- Hover (inactive): background `#F9FAFB`
- Settings at bottom, separated by border-top

## 5. Layout Principles

### Spacing System

Base unit: 4px

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Tight inline gaps, icon padding |
| sm | 8px | Between related elements, icon gaps |
| md | 12px | Card internal padding, form gaps |
| lg | 16px | Between cards, section internal padding |
| xl | 24px | Page padding, section gaps |
| 2xl | 32px | Between major sections |
| 3xl | 48px | Page top/bottom padding |

### Grid & Container

- Page content max-width: none (fills available space in sidebar layout)
- Page horizontal padding: 24px
- Page top padding: 24px
- Card gap: 16px
- Dashboard uses the full viewport minus sidebar — no centered max-width container

### Border Radius Scale

| Value | Context |
|-------|---------|
| 4px | Badges, small tags |
| 6px | Table cells, inline elements |
| 8px | Inputs, small buttons, nav items |
| 12px | Cards, modals, panels |
| 9999px | Pill buttons, pill badges |

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow, `#F9FAFB` surface | Page background |
| Resting | `0 1px 2px rgba(0,0,0,0.05)` + `#E5E7EB` border | Cards, containers |
| Raised | `0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)` | Hovered cards, dropdowns |
| Overlay | `0 4px 24px rgba(0,0,0,0.12)` | Modals, slide-out panels |
| Focus | `0 0 0 2px #FFFFFF, 0 0 0 4px #34D399` | Keyboard focus |

On light backgrounds, shadows do the work that color-shifts did on dark themes. The shadow stack is deliberately minimal — one or two layers max. Heavy shadows look dated on light UIs; WhatStage shadows should be barely perceptible until you look for them.

## 7. Do's and Don'ts

### Do

- Use `#F9FAFB` for the page background, `#FFFFFF` for cards — the contrast is subtle but essential
- Keep text at 12-14px in the dashboard — size hierarchy comes from weight and color, not scale
- Use Emerald (`#059669`) only for interactive elements — buttons, links, active states, toggles
- Apply 9999px radius to primary CTA buttons — the pill shape is the brand signature
- Use the semantic colors (success/warning/danger) for status badges consistently
- Keep card border radius at 12px — it's the default for all containers
- Use gray-200 (`#E5E7EB`) for borders everywhere — consistency over creativity

### Don't

- Don't use dark backgrounds in the dashboard — the light theme is fundamental
- Don't use more than one accent color — emerald is the only accent, everything else is gray
- Don't make text larger than 24px in the dashboard — save display sizes for marketing pages
- Don't use colored backgrounds for sections — depth comes from cards + shadows, not bg color
- Don't use thick borders (2px+) — 1px is the maximum for standard elements
- Don't introduce custom colors beyond the defined palette — the gray + emerald system is complete
- Don't use opacity for text hierarchy — use the defined gray scale instead

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <768px | Sidebar collapses to hamburger, single column, reduced padding |
| Tablet | 768-1024px | Sidebar remains collapsible, 2-column grids |
| Desktop | >1024px | Full sidebar, multi-column layouts |

### Touch Targets

- Minimum: 44x44px (WCAG)
- Buttons: 36px height minimum, 44px on mobile
- Nav items: 40px height
- Table rows: 48px minimum height

## 9. CSS Custom Properties

```css
:root {
  /* Surfaces */
  --ws-page: #F9FAFB;
  --ws-card: #FFFFFF;
  --ws-sidebar: #FFFFFF;

  /* Borders */
  --ws-border: #E5E7EB;
  --ws-border-subtle: #F3F4F6;
  --ws-border-strong: #D1D5DB;

  /* Text */
  --ws-text-primary: #111827;
  --ws-text-secondary: #374151;
  --ws-text-tertiary: #6B7280;
  --ws-text-muted: #9CA3AF;
  --ws-text-faint: #D1D5DB;

  /* Accent */
  --ws-accent: #059669;
  --ws-accent-hover: #047857;
  --ws-accent-light: #D1FAE5;
  --ws-accent-subtle: rgba(5, 150, 105, 0.08);
  --ws-focus-ring: #34D399;

  /* Semantic */
  --ws-success: #059669;
  --ws-success-light: #D1FAE5;
  --ws-warning: #D97706;
  --ws-warning-light: #FEF3C7;
  --ws-danger: #DC2626;
  --ws-danger-light: #FEE2E2;
  --ws-info: #2563EB;
  --ws-info-light: #DBEAFE;

  /* Shadows */
  --ws-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --ws-shadow-md: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
  --ws-shadow-lg: 0 4px 24px rgba(0,0,0,0.12);
}
```
