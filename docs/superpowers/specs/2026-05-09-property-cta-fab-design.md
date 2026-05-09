# Property Page CTA FAB

**Date:** 2026-05-09
**Status:** Approved

## Overview

Add a floating action button (FAB) to the property detail page (`/a/[slug]?property=[id]`) that gives visitors quick access to the linked action pages (booking, form, qualification) via a bottom sheet on mobile and a centered modal on desktop.

## Architecture

### New file

`src/app/a/[slug]/_kinds/realestate/CTAFab.client.tsx`

A single `'use client'` component colocated with the existing `Renderer.tsx`. All state lives here.

### Modified file

`src/app/a/[slug]/_kinds/realestate/Renderer.tsx`

Only `PropertyDetail` is changed. After loading `linkedPages`, it instantiates `CTAFab` and passes:

- `pages` — lightweight metadata array `{ id: string; kind: ActionPageRow['kind']; title: string; cta_label: string | null }[]`
- `accent` — theme accent color string for button styling
- `children` — each linked page's `<LinkedRenderer>` output as React nodes (server-rendered, no client fetch)

The existing "Next Steps" inline section is preserved unchanged.

### Component tree

```
PropertyDetail (server)
└─ CTAFab.client (client)
   ├─ FabButton     — circular accent-colored button, fixed bottom-right
   ├─ FabMenu       — pill buttons stacked above FAB when expanded
   └─ Sheet         — bottom sheet (mobile) / centered modal (desktop)
      └─ children[activeIndex]  — server-rendered form/booking/qualification
```

## FAB Behavior

### States

| State | Description |
|---|---|
| Collapsed | Circular FAB (✦ icon, accent color) fixed at `bottom-6 right-6` |
| Expanded | Pill buttons animate in above the FAB; icon rotates ~45°  |
| Sheet open | Backdrop dims the page; sheet slides up (mobile) or fades+scales in (desktop) |

### Button labels

Use `cta_label` from the linked page if set; fall back to `title`. Kind icon prefix: 📅 booking, 📋 form/qualification.

### 1-page shortcut

When exactly one linked page exists, tapping the FAB skips the expand menu and opens the sheet directly.

### Not rendered

When `linkedPages.length === 0`, `CTAFab` is not rendered — no empty FAB on the page.

## Sheet / Modal

### Responsive behavior

| Viewport | Style |
|---|---|
| `< lg` (mobile) | Bottom sheet — slides up from bottom, drag-handle decoration, `max-height: 85dvh` |
| `≥ lg` (desktop) | Centered dialog — fade + scale-in, `max-w-lg`, `max-height: 85dvh` |

### Sheet structure

```
┌─ drag handle (mobile only) ─────────────────┐
│ Title (linked page title)              [✕]  │
├─────────────────────────────────────────────┤
│ scrollable body                             │
│   → children[activeIndex]                  │
│     (server-rendered LinkedRenderer)        │
└─────────────────────────────────────────────┘
```

### Dismissal

- Tap/click backdrop
- Tap ✕ button in header
- Body scroll is locked (`overflow-hidden` on `<body>`) while sheet is open

### Switching pages

If the sheet is open and the user taps a different pill button, `activeIndex` updates and the sheet content swaps without closing.

### Post-submission

The sheet stays open after submission — the embedded renderer handles its own success state (same behavior as the inline "Next Steps" section).

## Data Flow

```
PropertyDetail (server)
  1. loadLinkedPages() → ActionPageRow[]
  2. Build pages metadata array (id, kind, title, cta_label)
  3. Map each row → <LinkedRenderer> (server-rendered React node)
  4. <CTAFab pages={...} accent={...}>{renderedNodes}</CTAFab>

CTAFab (client)
  5. Renders FabButton + FabMenu from pages metadata
  6. On button click: set activeIndex
  7. Sheet renders React.Children.toArray(children)[activeIndex]
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| 0 linked pages | CTAFab not rendered |
| 1 linked page | FAB tap opens sheet directly, no expand menu |
| Sheet open, tap different pill | activeIndex updates, content swaps |
| Successful form/booking submit | Sheet stays open, renderer shows its own success UI |
