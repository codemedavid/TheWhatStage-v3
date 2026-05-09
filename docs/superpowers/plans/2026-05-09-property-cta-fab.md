# Property Page CTA FAB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating action button (FAB) to the property detail page that expands into per-linked-page pill buttons and opens the linked booking/form/qualification renderers in a bottom sheet (mobile) or centered modal (desktop ≥ lg).

**Architecture:** A single `CTAFab.client.tsx` client component is mounted inside `PropertyDetail` (server component). The server passes lightweight page metadata as a `pages` prop and pre-rendered `LinkedRenderer` outputs as `children` — no new API routes needed. The FAB manages all interaction state (`expanded`, `activeIndex`) client-side.

**Tech Stack:** Next.js App Router (server + client components), React, Tailwind CSS v4, TypeScript, Vitest (jsdom)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/app/a/[slug]/_kinds/realestate/CTAFab.client.tsx` | FAB button, expand menu, bottom sheet / modal, body scroll lock, ESC key close |
| **Modify** | `src/app/a/[slug]/_kinds/realestate/Renderer.tsx` | Import and mount `CTAFab` at the end of `PropertyDetail` |

---

## Task 1: Create `CTAFab.client.tsx`

**Files:**
- Create: `src/app/a/[slug]/_kinds/realestate/CTAFab.client.tsx`

- [ ] **Step 1: Create the file with the full implementation**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import React from 'react'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

type PageMeta = {
  id: string
  kind: ActionPageKind
  title: string
  cta_label: string | null
}

function getFabButtonLabel(page: PageMeta): string {
  return page.cta_label ?? page.title
}

function getKindIcon(kind: ActionPageKind): string {
  return kind === 'booking' ? '📅' : '📋'
}

export default function CTAFab({
  pages,
  accent,
  children,
}: {
  pages: PageMeta[]
  accent: string
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const childArray = React.Children.toArray(children)

  useEffect(() => {
    document.body.style.overflow = activeIndex !== null ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [activeIndex])

  const close = useCallback(() => {
    setActiveIndex(null)
    setExpanded(false)
  }, [])

  useEffect(() => {
    if (activeIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, close])

  const handleFabClick = () => {
    if (pages.length === 1) {
      setActiveIndex(0)
      setExpanded(false)
    } else {
      setExpanded((prev) => !prev)
    }
  }

  if (pages.length === 0) return null

  return (
    <>
      {/* FAB + expand menu */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        {expanded && (
          <div className="flex flex-col items-end gap-2">
            {pages.map((page, idx) => (
              <button
                key={page.id}
                onClick={() => {
                  setActiveIndex(idx)
                  setExpanded(false)
                }}
                className="flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-medium text-[#1E293B] shadow-md transition hover:shadow-lg"
              >
                <span aria-hidden="true">{getKindIcon(page.kind)}</span>
                {getFabButtonLabel(page)}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleFabClick}
          aria-label="Property actions"
          aria-expanded={expanded}
          className="flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition hover:scale-105 active:scale-95"
          style={{ background: accent }}
        >
          <span
            aria-hidden="true"
            className="text-xl text-white transition-transform duration-200"
            style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(45deg)' : 'none',
            }}
          >
            ✦
          </span>
        </button>
      </div>

      {/* Bottom sheet (mobile) / Centered modal (desktop) */}
      {activeIndex !== null && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={close}
            aria-hidden="true"
          />

          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={pages[activeIndex]?.title}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl"
          >
            {/* Drag handle (mobile only) */}
            <div className="flex justify-center pt-3 lg:hidden">
              <div className="h-1 w-9 rounded-full bg-[#E2E8F0]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-5 py-4">
              <h2 className="text-[15px] font-semibold text-[#0F172A]">
                {pages[activeIndex]?.title}
              </h2>
              <button
                onClick={close}
                aria-label="Close"
                className="text-xl leading-none text-[#94A3B8] hover:text-[#475569]"
              >
                ✕
              </button>
            </div>

            {/* Body — server-rendered form/booking/qualification */}
            <div>{childArray[activeIndex]}</div>
          </div>
        </>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors in the new file**

```bash
cd /Users/codemedavid/Documents/WhatStage_V3 && npx tsc --noEmit 2>&1 | head -30
```

Expected: output is empty (no errors) or errors unrelated to `CTAFab.client.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/app/a/\\[slug\\]/_kinds/realestate/CTAFab.client.tsx
git commit -m "feat(realestate): add CTAFab client component"
```

---

## Task 2: Wire `CTAFab` into `PropertyDetail`

**Files:**
- Modify: `src/app/a/[slug]/_kinds/realestate/Renderer.tsx`

`PropertyDetail` already loads `linkedPages` and renders them inline in the "Next Steps" section. We add `CTAFab` just before the closing `</main>`, passing metadata + a fresh set of `LinkedRenderer` children (separate React tree instances from the inline ones — each has its own state).

- [ ] **Step 1: Add the import at the top of `Renderer.tsx`**

After the existing `import QualificationRenderer` line (currently line 18), add:

```tsx
import CTAFab from './CTAFab.client'
```

- [ ] **Step 2: Mount `CTAFab` inside `PropertyDetail`**

In `PropertyDetail`, find the closing `</div>\n    </main>` (the `max-w-5xl` wrapper div closing + `</main>`). Insert the `CTAFab` block between them:

```tsx
      </div>

      {linkedPages.length > 0 && (
        <CTAFab
          pages={linkedPages.map((p) => ({
            id: p.id,
            kind: p.kind,
            title: p.title,
            cta_label: p.cta_label,
          }))}
          accent={config.theme.accent_color}
        >
          {linkedPages.map((linked) => (
            <LinkedRenderer
              key={linked.id}
              page={linked}
              claims={claims}
              rawToken={rawToken}
              sourceContext={sourceContext}
            />
          ))}
        </CTAFab>
      )}
    </main>
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/codemedavid/Documents/WhatStage_V3 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Start dev server and verify manually**

```bash
pnpm dev
```

Navigate to a property detail page that has at least one linked action page (`/a/[slug]?property=[id]`). Verify all of the following:

**With 2+ linked pages:**
- FAB (✦ icon, accent color) appears fixed at bottom-right
- Clicking FAB expands pill buttons stacked above it, one per linked page
- Button label shows `cta_label` if set, otherwise page `title`
- Icon prefix: 📅 for booking, 📋 for form/qualification
- Clicking a pill opens the bottom sheet with the correct renderer
- Clicking backdrop closes the sheet
- Clicking ✕ button closes the sheet
- Pressing Escape closes the sheet
- Clicking FAB again collapses the menu
- Page scroll is locked while sheet is open and restored on close
- On desktop (≥ 1024px): sheet appears as a centered modal instead of bottom sheet

**With exactly 1 linked page:**
- Clicking FAB opens the sheet directly, no expand menu shown

**With 0 linked pages:**
- FAB is not rendered

- [ ] **Step 5: Commit**

```bash
git add src/app/a/\\[slug\\]/_kinds/realestate/Renderer.tsx
git commit -m "feat(realestate): mount CTAFab on property detail page"
```
