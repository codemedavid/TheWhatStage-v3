# WhatStage University — Build Spec (canonical)

> **This is the single buildable source of truth.** It synthesizes four design docs
> (`01-public-A` editorial, `02-public-B` streaming, `03-admin-cms`, `04-architecture`)
> into one reconciled plan. Where the source docs disagreed, this spec decides and says why.
> Engineers should build from THIS file. The four source docs are background only.
>
> **Non-standard Next.js (see `AGENTS.md`):** dynamic `params` are Promises and MUST be
> awaited (`const { courseSlug } = await params`). Read the relevant guide in
> `node_modules/next/dist/docs/` before writing routing code.

---

## 1. Summary + chosen public learner direction

### Chosen direction: **Hybrid — "Editorial shell, streaming spine" (A-structure + B-mechanics)**

We adopt **Direction A's editorial paper aesthetic and warm, doorway-not-wall conversion
philosophy** as the visual and emotional foundation, and **graft Direction B's resume-first
mechanics and curriculum-as-navigation** as the interaction spine. Concretely:

**Kept from A (the base):**
- Light, warm, paper-on-paper editorial look across **all three screens** (catalog, detail,
  player). The player is **light**, not B's dark theater — a "calm reading room," consistent with
  the WhatStage brand and the rest of the app.
- The disciplined **conversion semantics**: `graphite = "just log in (free)"`, `gold = "pay to
  unlock Pro"`, repeated identically on cards, the detail CTA panel, and the in-player
  interstitial. This trained-signal consistency is A's strongest idea and we keep it whole.
- A's **CTA-panel state matrix** (states A–F) on the course detail page as the per-course
  conversion engine.
- A's locked-but-legible treatment: locked cards keep full-ink titles/descriptions; you can read
  the value, you just can't play it. No blurred-with-no-explanation walls; no full-screen modal traps.

**Grafted from B (the spine):**
- **Resume-first "Continue learning" rail** at the top of the catalog for logged-in users with
  in-progress courses (B's single best idea). Deep-links straight back to the exact lesson + second.
- **Curriculum-as-navigation**: the course detail uses a **sticky curriculum list** (right column
  on desktop) and the player keeps a **persistent lesson sidebar** so "what's next" is always one
  click away. The `CurriculumList` component is **shared** between detail and player (B's reuse win).
- **Progress as a first-class citizen** on every surface: green completion fills on cards, an amber
  "resume here" marker, per-lesson state glyphs.
- B's **player ergonomics**: resume-on-load with an undo toast, debounced progress beacons,
  optional auto-advance "Up next", keyboard shortcuts.

**Rejected:**
- B's **dark `[data-uni-stage]` theater** — dropped. One light system is calmer, more on-brand, and
  half the CSS surface. (We keep a single optional dark token group only for the 16:9 video
  *letterbox* behind embeds, nothing else.)
- B's **rails-only browse** as the sole model — softened. We use A's **filterable editorial grid**
  as the primary catalog, with the Continue rail and an optional "Featured" rail layered on top.
  Rails are an accent, not the whole catalog.

**Rationale:** the audience (skeptical small-business owners) converts on editorial polish that
signals "worth your time and money" (A), but retains and re-engages on momentum/resume mechanics
(B). The hybrid gets both without the maintenance cost of two visual systems or a dark mode.

The **architecture doc (04)** is adopted **wholesale** — its security model (separate
`university_lesson_sources` table + `get_lesson_playback()` definer RPC) is the non-negotiable spine
and §6 below reconciles it against the public-page payloads. The **CMS doc (03)** is adopted
wholesale for the superadmin surface, with its route handler paths aligned to 04's API map.

---

## 2. Design tokens — `[data-university-root]` + `--uni-*`

Scope all public learner pages under a single `[data-university-root]` wrapper (set on
`src/app/university/layout.tsx`), exactly mirroring the existing `[data-leads-root]` /
`[data-actions-root]` pattern in `globals.css`. Tokens build on the **real** brand values confirmed
in `globals.css :root` (`--ws-accent:#1F7A4D`, `--ws-accent-soft:#E8F2EC`,
`--ws-accent-softer:#F2F8F4`, `--ws-accent-ink:#0F4A30`, `--ws-warn:#B8762B`,
`--ws-warn-soft:#FBF3E5`, `--ws-border:#E8E6DE`, `--ws-border-strong:#D9D6CC`,
`--ws-surface-3:#EFEEE8`).

**Where it goes:** append a new scoped block to `src/app/globals.css`, after the
`[data-actions-list]` block, clearly delimited with a banner comment
(`/* === WhatStage University — public learner scope === */`).

```css
/* === WhatStage University — public learner scope (catalog / detail / player) === */
[data-university-root] {
  /* ── Surfaces — paper, warmed a half-step from the app shell ── */
  --uni-bg:            #FBFAF6;   /* page canvas (≈ --ws-bg +warmth) */
  --uni-bg-deep:       #F4F1E9;   /* hero / footer / conversion bands, sectioning */
  --uni-surface:       #FFFFFF;   /* cards, CTA panel, player chrome */
  --uni-surface-2:     #F6F5F0;   /* inset rows, thumbnail fallback */
  --uni-surface-3:     #EFEDE5;   /* hover wells, skeleton base */
  --uni-border:        #E8E6DE;   /* = --ws-border */
  --uni-border-strong: #D9D5C9;   /* inputs, active outlines */

  /* ── Ink ramp — slightly deeper than app for editorial contrast ── */
  --uni-ink:           #171510;   /* headlines */
  --uni-ink-2:         #3C3A32;   /* body */
  --uni-ink-3:         #6B6960;   /* meta / captions */
  --uni-ink-4:         #9C9A8F;   /* faint labels, disabled */
  --uni-ink-invert:    #FBFAF6;   /* text on dark/accent */

  /* ── Accent — brand emerald ── */
  --uni-accent:        #1F7A4D;   /* primary CTA, progress, active */
  --uni-accent-2:      #166040;   /* CTA hover / pressed */
  --uni-accent-ink:    #0F4A30;   /* accent text on soft bg */
  --uni-accent-soft:   #E8F2EC;   /* badge bg (= --ws-accent-soft) */
  --uni-accent-softer: #F2F8F4;   /* hover wells, completed-row tint */
  --uni-accent-ring:   rgba(31,122,77,0.22); /* focus ring */
  --uni-progress-from: #1F7A4D;   /* progress bar gradient start */
  --uni-progress-to:   #2EA86A;   /* progress bar gradient end (matches dashboard hero) */

  /* ── Premium / subscriber — warm gold, reserved EXCLUSIVELY for "pay to unlock" ── */
  --uni-gold:          #A9792B;   /* Pro lock icon, spark glyph */
  --uni-gold-ink:      #6E4E18;   /* gold text on soft bg */
  --uni-gold-soft:     #F6EEDD;   /* Pro badge / upgrade panel bg */
  --uni-gold-border:   #E7D6B0;   /* upgrade panel hairline */
  --uni-gold-grad:     linear-gradient(135deg,#C79A48 0%,#A9792B 100%);

  /* ── Auth-gate (sign-in) — neutral graphite so it reads "free, just log in" ── */
  --uni-locked:        #6B6960;   /* auth lock icon */
  --uni-locked-soft:   #EFEDE5;   /* auth badge bg */

  /* ── Resume marker — amber "you are here" (distinct from green completion) ── */
  --uni-resume:        #B8762B;   /* = --ws-warn */

  --uni-danger:        #B23A2B;
  --uni-danger-soft:   #FBEBE7;

  /* ── Video letterbox — the ONLY dark surface in the public system ── */
  --uni-stage-bg:      #14120C;   /* 16:9 embed background while loading / behind iframe */

  /* ── Elevation — soft, paper-on-paper ── */
  --uni-shadow-sm: 0 1px 2px rgba(23,21,16,0.04);
  --uni-shadow-md: 0 1px 3px rgba(23,21,16,0.05), 0 8px 24px rgba(23,21,16,0.05);
  --uni-shadow-lg: 0 18px 48px -12px rgba(23,21,16,0.18);
  --uni-shadow-card-hover: 0 14px 30px -16px rgba(23,21,16,0.22);

  /* ── Radii ── */
  --uni-r-sm: 8px;
  --uni-r-md: 12px;
  --uni-r-lg: 16px;
  --uni-r-xl: 20px;

  /* ── Type (reuse global font vars — DO NOT add families) ── */
  --uni-serif: var(--font-instrument-serif), Georgia, serif;
  --uni-sans:  var(--font-geist-sans), -apple-system, sans-serif;
  --uni-mono:  var(--font-geist-mono), ui-monospace, monospace;

  /* ── Layout ── */
  --uni-maxw:      1180px;  /* catalog / detail content cap */
  --uni-maxw-read: 720px;   /* prose column */

  color: var(--uni-ink-2);
  background: var(--uni-bg);
  font-family: var(--uni-sans);
}

[data-university-root] .uni-focus:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--uni-bg), 0 0 0 4px var(--uni-accent-ring);
}

@media (prefers-reduced-motion: reduce) {
  [data-university-root] * { animation: none !important; transition: none !important; }
}
```

### Type scale

| Token / use            | Family | Size                        | Weight | Tracking |
|------------------------|--------|-----------------------------|--------|----------|
| Hero display           | serif  | `clamp(38px,6vw,66px)`      | 400    | -0.02em  |
| Page H1 (course title) | serif  | `clamp(30px,4vw,46px)`      | 400    | -0.018em |
| Section H2             | serif  | `26px`                      | 400    | -0.01em  |
| Card title             | sans   | `16px`                      | 600    | -0.005em |
| Body / prose           | sans   | `16px` / `1.7`              | 400    | normal   |
| Meta / eyebrow / kbd   | mono   | `11–12px` uppercase         | 500    | 0.06em   |
| Lesson list item       | sans   | `14.5px`                    | 500    | normal   |

### Buttons (rescoped, mirrors `.ap-btn`)

```css
[data-university-root] .uni-btn          { /* base: 44px tall on public, r-md, 14px/600 */ }
[data-university-root] .uni-btn-primary  { background: var(--uni-accent); color:#fff; }
[data-university-root] .uni-btn-primary:hover { background: var(--uni-accent-2); }
[data-university-root] .uni-btn-upgrade  { background: var(--uni-gold-grad); color:#fff; }
[data-university-root] .uni-btn-secondary{ background: var(--uni-surface); border:1px solid var(--uni-border-strong); }
[data-university-root] .uni-btn-ghost    { background: transparent; color: var(--uni-ink-2); }
```

**Icons:** hand-drawn inline `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">`
only — NO lucide, NO shadcn (locked brand rule). Required glyphs: `play`, `play-circle`, `check`,
`open-padlock` (auth gate), `closed-padlock` (Pro gate), `spark` (Pro), `chevron-left/right`,
`clock`, `book` (empty state), `list` (curriculum), `replay`, `x`.

---

## 3. Screens, layouts & states

Three public viewer states drive every gated surface (computed server-side per page):
```
session      = await getSession()                              // null | SessionContext
isSubscriber = !!session && (session.subscriptionTier === 'pro'
                            || session.role === 'admin' || session.role === 'superadmin')
viewer = !session ? 'guest' : isSubscriber ? 'subscriber' : 'member'   // 'member' = logged-in free
```

### 3.0 Public University layout / header

`src/app/university/layout.tsx` wraps children in `<div data-university-root>` and renders a slim
public top bar (NOT the app sidebar — middleware leaves `/university` public). Mirrors the minimal
`(auth)/layout.tsx`.

```
PUBLIC TOP BAR  (sticky, h-64px, --uni-bg, 1px bottom border)
┌────────────────────────────────────────────────────────────────────────────┐
│ [W] WhatStage · University     Courses  Pricing      [ Log in ] [Get started→]│
└────────────────────────────────────────────────────────────────────────────┘
  logo+wordmark      nav (active=ink, rest ink-3)      GUEST: ghost + primary
                                          LOGGED IN → right slot swaps to:
                                          ◷ My learning   (DA avatar)  [✦ Pro chip if subscriber]
```

---

### Screen 1 — `/university` catalog

Editorial grid (A) + Continue rail + optional Featured rail (B). Filter by category/access + client search.

#### 3.1 Layout — guest, populated

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [W] WhatStage·University   Courses Pricing      [ Log in ] [ Get started → ]   │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─ HERO (--uni-bg-deep band, 88px top pad) ───────────────────────────────┐  │
│  │  ✦ WHATSTAGE UNIVERSITY                          (mono eyebrow)          │  │
│  │  Learn to turn every conversation into a customer.   ← serif clamp 38–66 │  │
│  │  Free courses on chatbots, action pages, and Messenger growth — plus a   │  │
│  │  Pro track for the full playbook.                    ← 17px ink-3        │  │
│  │  [ Browse free courses ]  [ See Pro plan → ]   18 courses · 4h 20m       │  │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│  ┌─ FILTER BAR (sticky under top bar) ─────────────────────────────────────┐  │
│  │ CATEGORY: (All) Getting started  Chatbot  Action Pages  Growth          │  │
│  │ ACCESS:   [All][Free][Members][Pro]                     🔍 Search…  /    │  │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│  FEATURED ──────────────────────────────  (serif H2; optional rail)            │
│  [ big card ◯Free ]   [ big card ✦Pro ]                                         │
│  ALL COURSES ───────────────────────────  (serif H2)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    3-col desktop / 2-col tablet / 1 mob │
│  │[thumb]◯Fr│ │[thumb]⊟Sn│ │[thumb]✦Pro│                                       │
│  │ CHATBOT  │ │ ACTION   │ │ GROWTH    │                                       │
│  │ title    │ │ title    │ │ title     │                                       │
│  │ 4 lsn·18m│ │ 6 lsn·26m│ │ 5 lsn·30m │                                       │
│  │Start free│ │Sign in → │ │ ✦ Pro →   │                                       │
│  └──────────┘ └──────────┘ └──────────┘  …                                     │
│  ┌─ CONVERSION BAND (--uni-bg-deep, GUESTS ONLY) ──────────────────────────┐  │
│  │  ✦ Create a free account to track your progress.   [ Create account → ] │  │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│  FOOTER · © 2026 WhatStage · Privacy  Terms  Pricing                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Course card footer CTA — driven by `access × viewer`:**

| access \ viewer | guest               | member (free)         | subscriber         |
|-----------------|---------------------|-----------------------|--------------------|
| `public`        | Start free →        | Continue / Start →    | Continue / Start → |
| `authenticated` | ⊟ Sign in to start →| Start →               | Start →            |
| `subscriber`    | ✦ Unlock with Pro → | ✦ Upgrade to unlock → | Start →            |

Locked cards stay legible: full-ink title + description; thumbnail gets a soft `--uni-ink/8%` scrim
+ a centered lock glyph at ~30% opacity; the footer CTA carries the conversion line (gold for Pro,
graphite for sign-in). Whole card is one `<Link>`; the footer CTA is a visual affordance, not a
nested button (no nested interactives).

#### 3.2 Logged-in deltas
- **Continue learning rail** above Featured (only when the viewer has ≥1 in-progress course):
```
CONTINUE LEARNING ───────────────────────────────────  (serif H2)
┌──────────────────────────────────────────────────────────────────────┐
│ ┌────────┐ Train your AI chatbot's voice                              │
│ │[thumb] │ Lesson 2 of 4 · "Setting the tone"                         │
│ │ ▣ 50%  │ ████████████░░░░░░░░  50%        [ Resume → ]              │
│ └────────┘  (amber resume marker on thumb)                            │
└──────────────────────────────────────────────────────────────────────┘
horizontal scroll-snap + lead-edge-fade mask if >1; deep-links to exact lesson+second.
```
- Cards show a green progress hairline across the thumbnail bottom (hidden at 0%), a `✓ Completed`
  badge replacing the access badge at 100%.
- Guest conversion band hidden; for free members who hit a locked Pro course, replaced by a softer,
  dismissible "Go further with Pro" band (gold, never a modal).
- **Subscriber:** every Pro badge stays (earned status) but nothing is locked; all CTAs are
  Start/Continue; `✦ Pro` chip by the avatar; no upgrade bands.

#### 3.3 Catalog states
- **Loading:** hero renders from RSC instantly; grid → 6 skeleton cards (shimmer sweep, 1.4s;
  static under reduced-motion); filter bar disabled (`opacity .6`); `role="status"`. The Continue
  rail skeleton renders only when we already know the viewer is authed (avoid anon layout shift).
- **Empty (no published courses):** centered `--uni-surface` card, `book` glyph, serif "The library
  is being written.", sub copy, `[ Get started → ]` (guest) / `[ Go to dashboard → ]` (member).
- **Empty (filters match nothing):** "No courses match Pro + Chatbot." + `[ Clear filters ]` ghost.
- **Error (catalog query failed):** inline `--uni-danger-soft` banner "We couldn't load the course
  library." + `[ Try again ]`; hero + filter chrome still render (graceful degradation; never a
  blank page).

#### 3.4 Filtering behavior
Category = single-select pill row (from `university_categories`, "All" default). Access = segmented
control. Search = **client filter** over server-rendered cards (catalog is small, ≤~50 courses) via
`useTransition` (reuses the `lead-progress` top-loader). URL syncs `?category=&access=&q=` for
shareable/back-safe views.

---

### Screen 2 — `/university/[courseSlug]` detail

Two columns desktop: **prose + curriculum (left, scrolls)** + **sticky CTA panel (right)**. The
curriculum list is the shared `CurriculumList` (= the player sidebar). `params: Promise<{ courseSlug }>`
— **await it**. `notFound()` → `not-found.tsx` if the course isn't published (and viewer isn't superadmin preview).

#### 3.5 Layout — guest viewing a Pro course

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← All courses                                                                 │
│  ┌─ HEADER BAND (--uni-bg-deep) ──────────────────────────────────────────┐   │
│  │  GROWTH · 8 lessons · 1h 05m · ✦ Pro            (mono eyebrow)          │   │
│  │  The Messenger Growth Playbook                  ← serif clamp 30–46     │   │
│  │  The advanced funnels & scripts top operators use to 3× booked calls.  │   │
│  │  ◴ 1h 05m   ▤ 8 lessons   ⇲ Self-paced   ✦ Pro plan                    │   │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────── LEFT (prose+curriculum) ─────────┬─ RIGHT (sticky) ───┐ │
│  │  WHAT YOU'LL LEARN  ✓ … ✓ …                          │ ┌────────────────┐ │ │
│  │  ABOUT THIS COURSE  (prose, --uni-maxw-read, 16/1.7) │ │  CTA PANEL     │ │ │
│  │  CURRICULUM                       8 lessons · 1h05    │ │  (state A–F,   │ │ │
│  │  ┌──────────────────────────────────────────────┐    │ │   §3.6)        │ │ │
│  │  │ ✓ 1  Welcome & growth mindset   PREVIEW ▶ 2:10│    │ │  sticky top:80 │ │ │
│  │  │ ⊠ 2  The retargeting framework         8:40   │    │ └────────────────┘ │ │
│  │  │ ⊠ 3  Writing the re-open script        7:15   │    │  ✓ 18 courses     │ │
│  │  │ … ⊠ = Pro-locked (gold padlock, row muted)    │    │  ✓ New monthly    │ │
│  │  │     ▶ PREVIEW = playable by anyone             │    │  ✓ Cancel anytime │ │
│  │  └──────────────────────────────────────────────┘    │                   │ │
│  └───────────────────────────────────────────────────────┴───────────────────┘ │
│  RELATED COURSES ────  (3 cards, catalog anatomy)                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Curriculum row state glyphs** (28px) — shared with the player sidebar:
`✓` complete (accent fill, white check, logged-in) · `◐` in-progress (emerald ring, resume here) ·
`▶` available (entitled, not started) · `▶ PREVIEW` (is_preview, anyone) · `⊟` auth-locked
(graphite open-padlock) · `⊠` Pro-locked (gold closed-padlock). Entitled rows are `<Link>` →
`/university/[courseSlug]/[lessonSlug]`. Locked rows are `<button>` that pulse/scroll the CTA panel
(mobile: open the bottom sheet); a per-lesson `resume_seconds` mini-bar shows on the in-progress row.

#### 3.6 CTA panel — the conversion core (states A–F)

`position:sticky; top:80px; --uni-surface; --uni-shadow-md`. On mobile collapses to a **fixed
bottom action bar** that expands to a sheet (the single most important mobile conversion decision).

- **State A — guest, `public`:** `◯ FREE COURSE` · `[ Start course → ]` (→ lesson 1) · soft "Want
  to save your progress? [ Create free account ]".
- **State B — guest, `authenticated` (LOG-IN conversion):** `⊟ MEMBERS COURSE` · "Sign in to start —
  it's free." · "Included with any free WhatStage account." · **`[ Create free account → ]`** primary
  + `[ Log in ]` ghost (both carry `?next=<this url>`) · if a preview lesson exists, surface
  `▶ Lesson 1 is free [ Watch preview ]`.
- **State C — guest OR member, `subscriber` (PAY conversion — the hero state):** `✦ PRO COURSE` ·
  gold-gradient header band "Unlock the full Pro library" · value framing (this course + N more) ·
  `₱ ___ /mo · cancel anytime` · **`[ ✦ Subscribe to unlock → ]`** (`uni-btn-upgrade`) · benefit
  checklist · `▶ Lesson 1 is free [ Watch free preview ]` if present · guest-only `Already Pro?
  [ Log in ]`.
- **State D — member, `authenticated`:** `◯ INCLUDED IN YOUR PLAN` · `[ Start course → ]`.
- **State E — entitled + in progress:** `◐ IN PROGRESS · 50%` · emerald bar · "Lesson 2 of 4
  «Setting the tone»" · `[ Resume course → ]` (jumps to resume lesson + position) · `[ ↺ Start over ]`.
- **State F — entitled + completed:** `✓ COMPLETED` · "🎉 You finished this course." (subtle
  hand-drawn confetti) · `[ ↺ Rewatch ]` · "Up next:" next-course mini-card cross-sell.

**Pricing copy is a placeholder** (`₱ ___ /mo`) and the "Subscribe"/"See Pro" CTA targets a
pricing/contact route until billing exists — see Open Question Q1.

#### 3.7 Detail states
- **Loading:** header band copy from RSC; curriculum → 6 skeleton rows; CTA panel → fixed-height
  skeleton (no layout shift).
- **Empty (0 published lessons):** curriculum area "Lessons are being added to this course." + CTA
  degrades to disabled "Coming soon" (ghost, not-allowed).
- **Not found / unpublished:** `notFound()` → editorial 404 "We couldn't find that course." +
  `[ Browse all courses → ]` (mirror `a/[slug]/not-found.tsx`).
- **Locked-auth (State B) / locked-subscriber (State C):** these are *designed surfaces*, not errors.

---

### Screen 3 — `/university/[courseSlug]/[lessonSlug]` player

The reading room: light player column + **persistent lesson sidebar**. Server access-checks BEFORE
the embed/signed URL reaches the client (locked product decision; §6). `params: Promise<{ courseSlug,
lessonSlug }>` — **await it**.

#### 3.8 Layout — entitled viewer, mid-course

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [W]·University   ← The Messenger Growth Playbook            (DA) [✦ Pro]        │
├───────────────────────────────────────────────────┬────────────────────────────┤
│  PLAYER COLUMN (flex-1, max 920px)                 │  LESSON SIDEBAR (320px)     │
│  ╔══════════════════════════════════════════════╗ │  sticky; inner-scrolls      │
│  ║   16:9 VIDEO — provider embed (--uni-stage-bg) ║ │ ┌────────────────────────┐ │
│  ║   youtube|vimeo|loom|imagekit per lesson       ║ │ │ Course title           │ │
│  ╚══════════════════════════════════════════════╝ │ │ ████████░░░  3/8 · 38% │ │
│  GROWTH · LESSON 3 OF 8        ◴ 7:15              │ ├────────────────────────┤ │
│  Writing the re-open script    ← serif 30px        │ │ ✓ 1 Welcome      2:10  │ │
│  [ ✓ Mark complete ] [ Mark complete & next → ]    │ │ ✓ 2 Framework    8:40  │ │
│  ─────────────────────────────────────────────────│ │ ◐ 3 Re-open ◄now 7:15 │ │ ← active rail
│  ABOUT THIS LESSON (prose, --uni-maxw-read)        │ │ ▶ 4 Cart nudge   6:30  │ │
│  ┌─ FOOTER NAV ─────────────────────────────────┐ │ │ ⊠ 6 …(if mixed)        │ │
│  │ [ ← 2. The framework ]     [ 4. Cart → ]     │ │ │ …                      │ │
│  └──────────────────────────────────────────────┘ │ └────────────────────────┘ │
│                                                    │ [ ✦ You're on Pro ] / upsell│
└───────────────────────────────────────────────────┴────────────────────────────┘
Mobile: sidebar → "Lessons (3/8)" disclosure / bottom sheet; footer prev/next → fixed bottom bar.
```

#### 3.9 Video area by provider
Single `<LessonPlayer playback={…} resumeSeconds={…}>` client component. The server passes the
**final embed URL or signed URL only** (never provider ids / raw paths) via `getLessonPlayback` (§6):
- `youtube`/`vimeo`/`loom` → `<iframe src={playback.embedUrl}>` inside a 16:9 `aspect-ratio` box
  (`--uni-stage-bg` while loading, `--uni-r-lg`, `--uni-shadow-md`).
- `imagekit` → native `<video controls preload="metadata" src={playback.signedUrl}>` (full
  resume/progress control). On `error` or near-expiry (`expiresAt`), the player re-requests playback.

**Ergonomics:** resume-on-load seek to `resume_seconds` + a 4s "Resuming from 3:42 — [ Start over ]"
toast (undo seeks to 0). Progress capture (native + YouTube/Vimeo SDK `timeupdate`) → debounced
**≥10s + on pause/`visibilitychange→hidden`/`pagehide`** (use `sendBeacon` where possible) calling
`saveProgressAction`. At ≥90% watched → optimistic auto-complete (explicit button is the fallback).
Optional "Up next" auto-advance card (8s, cancelable) on `ended`; if the next lesson is gated, show
the upsell instead of advancing. Keyboard (only when focus isn't in an input): `Space`/`k`
play-pause, `←/→` seek 5s, `f` fullscreen, `n`/`p` next/prev, `Esc` to course.

#### 3.10 Locked interstitial — not entitled (in-player conversion)
If a viewer deep-links a lesson they aren't entitled to (and it isn't a preview), the **server never
calls the RPC for a source** and renders `<LockScreen>` in place of the embed. The surrounding chrome
(sidebar with visible titles/durations, breadcrumb) stays intact — "inside the academy at a locked
door," never a dead end.
- **Auth-locked:** dark 16:9 panel, blurred thumb + scrim, open padlock, serif "Sign in to watch
  this lesson", "It's free with any WhatStage account.", `[ Create free account → ]` + `[ Log in ]`
  (`?next=<this lesson>`).
- **Pro-locked:** gold-tinted scrim, spark, "This is a Pro lesson", `₱ ___ /mo · cancel anytime`,
  `[ ✦ Subscribe to unlock → ]`, and `▶ Lesson 1 of this course is free [ Watch it ]` if a preview exists.

#### 3.11 Player states
- **Loading embed:** 16:9 `--uni-stage-bg` frame + emerald spinner ("Loading lesson…"); sidebar +
  title render from RSC first; reduced-motion → static "Loading…".
- **Empty (no video set):** "This lesson's video is being prepared." inside the frame; Mark-complete
  disabled; prev/next still work.
- **Completed lesson (revisiting):** `✓ Completed` chip; primary → "Next lesson →"; on the last
  lesson → "Finish course →" → routes back to detail State F (confetti micro-moment).
- **Anon on a gated lesson:** locked stage (§3.10) — embed URL never emitted.
- **Embed error:** in-frame "We couldn't load this video. [ Retry ] · [ Back to course ]"; progress
  not lost; sidebar intact.
- **Progress save error:** silent retry w/ backoff; on repeated failure a non-blocking toast "We
  couldn't save your progress — check your connection." Playback never interrupts.
- **Anon viewer (any lesson):** no save calls; sidebar shows "Log in to track your progress" hint.

#### 3.12 Responsive summary

| Breakpoint        | Catalog | Detail                        | Player                                 |
|-------------------|---------|-------------------------------|----------------------------------------|
| ≥1024 (desktop)   | 3 col   | 2-col (prose + sticky CTA)    | player + 320px sidebar                 |
| 768–1023 (tablet) | 2 col   | 1-col, CTA after prose        | player full, sidebar → top disclosure  |
| <768 (mobile)     | 1 col   | 1-col + fixed bottom CTA bar  | player full, fixed prev/next bar, lessons bottom-sheet |

All gated CTAs collapse on mobile into a **fixed bottom action bar** (thumb-reachable, always visible).

---

## 4. Component inventory

All client components are `'use client'`; pages are async RSC. Props are serializable (server →
client). View-model types live in `src/lib/university/types.ts` (§8).

| Component | File | Props (shape) |
|---|---|---|
| `UniversityShell` | `university/_components/UniversityShell.tsx` | `{ viewer: 'guest'\|'member'\|'subscriber'; user?: { name:string; initials:string }; nav: {href:string;label:string}[] }` |
| `CatalogClient` | `university/_components/CatalogClient.tsx` | `{ courses: CourseCardVM[]; categories: {slug:string;name:string}[]; continueItems: ResumeVM[]; viewer; initialFilters:{category:string;access:string;q:string} }` |
| `CourseCard` | `university/_components/CourseCard.tsx` | `{ course: CourseCardVM; viewer; href:string; ctaLabel:string; locked:boolean; progressPct:number\|null; completed:boolean }` |
| `AccessBadge` | `university/_components/AccessBadge.tsx` | `{ kind: 'free'\|'auth'\|'pro'\|'completed'\|'in-progress'; pct?:number }` |
| `LockBadge` | (part of `AccessBadge`) | `{ kind:'auth'\|'pro' }` → graphite open-padlock / gold closed-padlock |
| `ProgressBar` | `university/_components/ProgressBar.tsx` | `{ pct:number; label?:string }` → `role="progressbar"` + `linear-gradient(90deg,var(--uni-progress-from),var(--uni-progress-to))` |
| `ProgressRing` | `university/_components/ProgressRing.tsx` | `{ pct:number; size?:number }` (thumbnail-corner ring) |
| `ContinueRail` | `university/_components/ContinueRail.tsx` | `{ items: ResumeVM[] }` (scroll-snap + edge-fade) |
| `CourseDetailClient` | `university/[courseSlug]/_components/CourseDetailClient.tsx` | `{ course: CourseDetailVM; lessons: LessonRowVM[]; coursePct:number; resume?:{lessonSlug:string;seconds:number}; ctaState:'A'..'F'; viewer; priceLabel:string }` |
| `CtaPanel` | `.../CtaPanel.tsx` | `{ state:'A'..'F'; course; resume?; previewLessonSlug?:string; priceLabel:string; nextCourse?:{slug:string;title:string} }` |
| `CurriculumList` | `university/_components/CurriculumList.tsx` (**shared**) | `{ courseSlug:string; lessons: LessonRowVM[]; activeLessonSlug?:string; variant:'detail'\|'player'; onLockedClick?:()=>void }` |
| `LessonRow` | (part of `CurriculumList`) | `{ lesson: LessonRowVM; active:boolean; locked:boolean }` |
| `LessonPlayer` | `university/[courseSlug]/[lessonSlug]/_components/LessonPlayer.tsx` | `{ playback: LessonPlayback; resumeSeconds:number; lessonId:string; canTrack:boolean; onComplete:()=>void }` |
| `PlayerSidebar` | `.../PlayerSidebar.tsx` | `{ courseSlug; lessons: LessonRowVM[]; activeLessonSlug; coursePct:number; entitlementChip:'pro'\|'upsell'\|null }` |
| `LockScreen` | `.../LockScreen.tsx` | `{ reason:'needs_login'\|'needs_subscription'; courseSlug:string; previewLessonSlug?:string; nextUrl:string }` |
| `UpsellCard` | `university/_components/UpsellCard.tsx` | `{ onClose:()=>void; href:string }` (custom fixed-overlay modal) |

---

## 5. Superadmin CMS (`/dashboard/university`, `role === 'superadmin'`)

Adopts CMS doc (03) wholesale. Inside `(app)`; built in the `[data-actions-list]` (list) and
`[data-actions-root]` (editor) idioms with one new scoped token block `[data-university-admin]`.
Every page gates: `getSession()` → `if (role !== 'superadmin') redirect('/dashboard')`.

### 5.1 Sidebar nav (edit `sidebar.tsx`)
Confirmed pattern: `type NavItem = { href; label; icon; requiresFacebookPage? }` and
`items.filter((item) => !item.requiresFacebookPage || hasFacebookPage)`. Extend with a parallel flag:

```ts
type NavItem = { href:string; label:string; icon:IconName; requiresFacebookPage?:boolean; requiresSuperadmin?:boolean }
{ href:'/dashboard/university', label:'University', icon:'university', requiresSuperadmin:true }
// visibleItems = items.filter(i => (!i.requiresFacebookPage || hasFacebookPage) && (!i.requiresSuperadmin || isSuperadmin))
```
`isSuperadmin` comes from the session the sidebar already loads. New 1.75-stroke `university` icon
(mortarboard): `<path d="M12 4 2 9l10 5 10-5-10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M21 9v5"/>`.

### 5.2 Screen A — Course list `/dashboard/university`
`[data-actions-list]` idiom: hero + stat strip + filter tabs + search + `.apl-table`. Lists **ALL**
courses (incl. drafts). University-specific grid:
```
COURSE (thumb+title+slug) | ACCESS pill | STATUS pill | LESSONS | UPDATED | ⋯
grid-template-columns: 2.6fr 1fr 1fr 0.8fr 1fr 56px
```
- **ACCESS pill** (`.uni-access`): `○ Public` (surface-2/ink-3) · `◐ Auth` (accent-softer/accent-ink) ·
  `🔒 Subscriber` (accent-soft/accent-ink, padlock).
- **STATUS pill** reuses `.apl-pill`: `● Live` (`.live`) / `◌ Draft` / `⊘ Archived` (`.archived`).
- **Default sort:** status weight then `updated desc` (CMS operator wants drafts/recent first;
  mirror `SuperadminDashboard` STATUS_SORT).
- **Row `⋯` menu** (custom anchored popover, closes on outside-click + `Escape`): Edit · Preview
  (public; draft/archived open `?preview=<signed token>`) · Publish/Unpublish/Archive · Delete… .
  Mutations mirror `UserRowActions`: `useTransition` + `fetch(...status route, POST)` →
  `router.refresh()`; inline `.text-red-600` on error.
- **Publish guard** (UI-disabled + tooltip, re-validated server-side): blocked if 0 lessons or any
  lesson has an empty/invalid source. Copy: "Add at least one playable lesson before publishing."
- **Delete** = custom overlay modal, **type-the-slug to confirm** (cascades to lessons + progress).
- **States:** loading skeleton (`loading.tsx`); `.apl-empty` (no courses) "No courses yet" +
  `[ + New course ]`; filter-empty inline; red banner on query error; row-mutating dims to `.6`.

### 5.3 Screen B — Course editor `/dashboard/university/[courseId]/edit` (+ `/new`)
`[data-actions-root]` idiom: editor topbar (back + breadcrumbs + `◌ Draft | ● Live` status segment),
section cards, sticky `.ap-save-bar`. One `useActionState` form (course + lessons serialized
together; mirrors `BusinessForm` — `pending` disables Save, `state.fieldErrors[name]` renders red
helper). Optional live preview rail (`.ap-content.with-preview`) shows the focused lesson's embed.

**Course-details fields:** Title (1–120, echoes into `.ap-head h1`) · Slug (`.ap-input-affix`
`/university/` + 🔄 regen; auto-from-title until `slugTouched`; `^[a-z0-9][a-z0-9-]{1,79}$`;
collision → fieldError) · Subtitle · Description (plain `.ap-textarea` — do NOT pull in Tiptap) ·
Cover image (ImageKit URL + 64×40 thumb; no uploader in v1) · Category (`.ap-select`) · Access level
(`.ap-select` public/authenticated/subscriber; gated value with no preview lesson → inline note
"Mark a lesson as Preview below").

**Lesson editor** — accordion list of rows (collapsed summary / expanded edit), drag-to-reorder by
the `⠿` handle only:
- Collapsed: `⠿  #  title  ▶ Provider  mm:ss  ☆Preview  ⌄`; a row with empty `provider_ref` shows a
  `--ws-warn` "needs a video" dot.
- Expanded fields: Title · Provider `.ap-select` (`YouTube|Vimeo|Loom|ImageKit`) · Video URL-or-ID
  `.ap-input` with live `✓/✕` validity tick + provider help hint · Duration (`mm:ss`→`duration_sec`,
  optional) · `☑ Free preview lesson` (helper "Visible to everyone, even when gated"; soft warning if
  unchecking the only preview on a gated course) · live 16:9 embed preview (**lazy: only the focused
  row mounts an iframe**) · `[ 🗑 Remove ]` (persisted rows mark-for-delete with an undo strip,
  flushed on Save).
- **Provider parse/normalize** (shared `_lib/providers.ts`, used client + server — never trust the
  client): store **normalized ids**, not full URLs (so we never render an attacker URL). Mapping in §10.
- **Reorder mechanics:** native HTML5 DnD (no new dep); reassign `position` 0..n-1 on drop; persisted
  transactionally on Save via the reorder RPC (avoid the `unique(course_id, position)` mid-update
  collision — see §8 risk). Mobile fallback: ▲/▼ buttons. Keyboard: focusable handle + `↑/↓` +
  `aria-live`.
- **New course** (`/new`): one empty expanded lesson pre-added (standalone video = 1-lesson course),
  status forced Draft; Save creates then redirects to `/[courseId]/edit`.
- **Save/dirty model:** sticky `.ap-save-bar` (Clean / `● Unsaved changes` + Discard + Save / Saving
  `…` / Error banner); `beforeunload` + in-app confirm on dirty navigation.

### 5.4 Screen C — Subscriber tier toggle (extend `SuperadminDashboard.tsx`)
Per locked decision, "Subscriber" = `subscription_tier='pro'` OR role admin/superadmin, so the
control governs **only** `subscription_tier` (`free ⇄ pro`); staff rows show a static `✦ Pro (role)`
chip (no control). Add a **TIER** column between Role and Status in the existing plain users table
(match its neutral Tailwind idiom, not `.apl-*`).
- Add `subscription_tier` to the `select(...)` and `ProfileRow` type (currently selects
  `id,email,full_name,role,status,created_at`).
- New `UserTierToggle` client component (`'use client'`, `useTransition`, `router.refresh()`): a
  two-segment `Free | Pro` pill (`.uni-tier`, active segment styled like `.ap-seg-btn.active`, Pro
  segment emerald + `✦`). Click inactive → small inline confirm popover (low-stakes, reversible) →
  `fetch('/api/superadmin/users/[id]/tier', { POST, body:{ tier:'pro'|'free' } })`. Self row → `—`;
  pending → disabled + thin progress; error → inline red text under the row.
- **New route** `POST /api/superadmin/users/[id]/tier`: copy the confirmed status-route 1:1
  (`runtime='nodejs'`, `dynamic='force-dynamic'`, 401 if unauth, 403 if not superadmin, 403 on self,
  404 if missing). Body `z.object({ tier: z.enum(['free','pro']) })`, update `{ subscription_tier }`.
  Also reject server-side if `target.role !== 'user'` ("tier is role-derived for staff").

### 5.5 Admin token block `[data-university-admin]`
Small scoped block layered on `--ws-*` (don't fork the palette) — access-level semantics, lesson-row
DnD (`--uni-admin-drop-line: var(--ws-accent)`, drag shadow), embed letterbox
(`--uni-admin-preview-bg:#14120C`), validity (`valid:var(--ws-accent)` / `invalid:var(--ws-warn)`),
tier (`pro-bg:var(--ws-accent-soft)`). Everything else reuses existing `.ap-*`/`.apl-*` classes.

---

## 6. Access control — the reconciled gating mechanism

**Adopted in full from architecture doc 04.** The one hard requirement:

> A logged-out visitor, or a logged-in non-subscriber, MUST NOT be able to fetch the playable video
> source (provider id / signed URL) of a gated lesson — via the anon Supabase client or any public
> page payload — while STILL being able to see locked lesson titles in the curriculum.

### Mechanism (two layers; DB is the wall)
1. **Table split.** Public-safe metadata (`title`, `provider`, `duration`, `is_preview`, `position`)
   lives in `university_lessons`. The **playable identity** (`provider_video_id`, `provider_hash`,
   `source_path`) lives in a separate **`university_lesson_sources`** table that has **RLS enabled,
   zero policies, and `revoke all ... from anon, authenticated`** — no client can ever read it, not
   even via `select *`. The secret simply isn't in any table the public reads.
2. **Definer RPC `get_lesson_playback(p_lesson_id uuid)`** (`security definer set search_path=public`,
   granted to `anon, authenticated`) is the **sole** read path for a source. It re-derives
   entitlement **inside the DB** from `auth.uid()` / `current_role()` / `is_subscriber()` and returns
   an empty set for unauthorized callers, unknown lessons, or unpublished courses (no existence leak).
   For `imagekit` it returns `source_path` **only to entitled callers**; the app then signs it with
   `IMAGEKIT_PRIVATE_KEY` (the key never enters Postgres → an unauthorized caller can never obtain a
   signable path).

### Entitlement truth table (single contract for SQL RPC **and** `access.ts`)

| access_level | is_preview | anon | authed non-sub | subscriber (pro/admin) | superadmin |
|---|---|---|---|---|---|
| public        | –     | ✅ | ✅ | ✅ | ✅ |
| authenticated | false | ❌ login | ✅ | ✅ | ✅ |
| authenticated | true  | ✅ | ✅ | ✅ | ✅ |
| subscriber    | false | ❌ login | ❌ subscribe | ✅ | ✅ |
| subscriber    | true  | ✅ | ✅ | ✅ | ✅ |
| draft course  | any   | ❌ | ❌ | ❌ | ✅ (superadmin only) |

### Player page data flow (the sensitive route)
```
page.tsx (RSC)
 ├ session = await getSession()
 ├ { course, lesson } = await loadLessonContext(courseSlug, lessonSlug)   // metadata only — NEVER sources
 ├ ent = getEntitlement(session, course, lesson)
 ├ if (!ent.allowed) → render <LockScreen reason={ent.reason} />          // STOP — no RPC call
 ├ playback = await getLessonPlayback(lesson.id)                          // RPC re-checks in the DB
 ├ if (!playback) → <LockScreen reason="needs_subscription" />            // DB said no
 └ <LessonPlayer playback={playback} resumeSeconds={...} .../>            // embedUrl/signedUrl ONLY
```
`getEntitlement` (TS, `access.ts`) is **advisory UX**; the RPC is the authoritative wall — even if
the TS gate had a bug, the DB check denies the source. A vitest parity test pins both to the table above.

### GAP found & FIXED (reconciliation with the public pages)
Docs A and B both proposed loading the catalog/detail via `createAdminClient()` (service role) and
"only including `embed_ref` for entitled lessons." **That is a footgun** under doc 04's model: the
service-role client **bypasses RLS**, so a `select *` mistake on a combined `university_lessons` table
could leak sources into a public RSC payload — exactly the hard-requirement violation. **Reconciled rule:**

- **Public reads (`data.ts`) MUST use the cookie-bound anon client** (`createClient()`), so RLS is the
  enforcer for catalog/detail/lesson-context queries, and they **must never select from
  `university_lesson_sources`** (the table split makes a leak structurally impossible anyway). The
  `unstable_cache` + cache-tag pattern from `a/[slug]/_lib/load.ts` still applies for catalog
  (anon-readable published rows).
- **Sources are obtained ONLY through `getLessonPlayback()`** (which uses the cookie-bound anon client
  → the RPC runs under the caller's `auth.uid()`). The service-role/admin client is used **only** for
  superadmin write paths (`admin.ts` + CMS route handlers), never to read sources into a public page.
- **Code-review gate:** any non-RPC read of `university_lesson_sources`, or any `select *` on a
  future combined view, is rejected.

### `is_subscriber()` reads `profiles` (not the JWT)
`subscription_tier` is **not** in the JWT (`custom_access_token_hook` only injects `role`). So
`is_subscriber()` reads `profiles` live — which also avoids stale-JWT issues for a just-demoted admin.
Changing tier requires **no token refresh** (every `getSession()` re-reads it).

### Self-escalation blocked
The existing RLS policy is named **`profiles_update_self_safe_fields`** (confirmed in
`20260605000000_profiles_lock_self_update.sql`) and currently pins `id/email/role/status` only. The
tier migration **must drop and recreate it adding `subscription_tier`** to the `with check` (§8) so a
user cannot self-grant `pro`. `profiles_update_superadmin` already allows superadmin updates (the
toggle works through it / the service-role route bypasses RLS).

---

## 7. Route map (pages / layouts / handlers / actions + access)

### Public — `src/app/university/` (top-level, NOT in `(app)`; middleware leaves it public)
| Path | File | Type | Access |
|---|---|---|---|
| `/university` | `university/layout.tsx` | layout | public — wraps `[data-university-root]` |
| `/university` | `university/page.tsx` | RSC | public — catalog of published courses |
| `/university/[courseSlug]` | `university/[courseSlug]/page.tsx` | RSC | public; `notFound()` if not published (non-superadmin) |
| `/university/[courseSlug]` | `university/[courseSlug]/not-found.tsx` | not-found | public |
| `/university/[courseSlug]/[lessonSlug]` | `.../[lessonSlug]/page.tsx` | RSC | public route; **gated content** via §6 flow |

> Do **NOT** add `/university` to `APP_PATH_PREFIXES` in `proxy.ts` — gating is per-content via the
> RPC, not per-route. Confirmed: the proxy only guards `/dashboard*`.

### Public progress server actions — `src/app/university/actions.ts` (`'use server'`)
| Action | Signature | Access |
|---|---|---|
| `saveProgressAction` | `(lessonId, resumeSeconds) ⇒ {ok}` | authed; calls `upsert_lesson_progress` RPC (returns `{ok:false}` for anon) |
| `markLessonCompleteAction` | `(lessonId) ⇒ {ok}` | authed; same RPC with `p_complete=true` |

### Superadmin — `src/app/(app)/dashboard/university/` (gated `role==='superadmin'`)
| Path | Type | Access |
|---|---|---|
| `/dashboard/university` | RSC + client list | superadmin |
| `/dashboard/university/new` | RSC + client editor | superadmin |
| `/dashboard/university/[courseId]/edit` | RSC + client editor | superadmin |

### Superadmin route handlers (service-role writes; each: `getSession()`→403 if not superadmin→zod→`createAdminClient()`→`revalidateTag/Path`)
| Handler | Method | Purpose |
|---|---|---|
| `/api/superadmin/university/courses` | POST | create course |
| `/api/superadmin/university/courses/[id]` | PATCH / DELETE | update / delete (cascade) course |
| `/api/superadmin/university/courses/[id]/status` | POST | publish / unpublish / archive |
| `/api/superadmin/university/courses/[id]/reorder` | POST | set catalog `position` |
| `/api/superadmin/university/lessons` | POST | create lesson + source (atomic via `superadmin_upsert_lesson` RPC) |
| `/api/superadmin/university/lessons/[id]` | PATCH / DELETE | update lesson meta/source; reorder |
| `/api/superadmin/users/[id]/tier` | POST | grant/revoke `subscription_tier` (copy of status route) |

---

## 8. Data layer — finalized DDL + `src/lib/university/*` plan

**Adopted from doc 04.** Three migration files (timestamps just past the latest existing
`20260609000000_*`; suggested: `20260610000000`, `20260610000100`, `20260610000200`). All follow repo
conventions: `gen_random_uuid()` PKs, `set_updated_at()` trigger, slug check
`^[a-z0-9][a-z0-9-]{1,79}$`, `create type ... as enum`, RLS, `security definer set search_path=public`
+ `revoke all ... ; grant execute ...` on functions.

### Migration 1 — `20260610000000_profiles_subscription_tier.sql`
```sql
create type public.subscription_tier as enum ('free', 'pro');

alter table public.profiles
  add column subscription_tier public.subscription_tier not null default 'free';

create index if not exists profiles_subscription_tier_idx
  on public.profiles (subscription_tier);

-- Re-create the self-update lock to ALSO pin subscription_tier (block self-escalation).
drop policy if exists profiles_update_self_safe_fields on public.profiles;
create policy profiles_update_self_safe_fields
on public.profiles for update to authenticated
using ( id = auth.uid() )
with check (
  id = auth.uid()
  and id                = (select id                from public.profiles where id = auth.uid())
  and email             = (select email             from public.profiles where id = auth.uid())
  and role              = (select role              from public.profiles where id = auth.uid())
  and status            = (select status            from public.profiles where id = auth.uid())
  and subscription_tier = (select subscription_tier from public.profiles where id = auth.uid())
);

create or replace function public.is_subscriber()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.subscription_tier = 'pro' or p.role in ('admin','superadmin'))
  );
$$;
revoke all on function public.is_subscriber() from public;
grant execute on function public.is_subscriber() to anon, authenticated;
```

### Migration 2 — `20260610000100_university_schema.sql` (tables + RLS)
```sql
create type public.university_access_level  as enum ('public','authenticated','subscriber');
create type public.university_course_status as enum ('draft','published','archived');
create type public.university_video_provider as enum ('youtube','vimeo','loom','imagekit');

-- (Optional) categories
create table public.university_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.university_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (char_length(title) between 1 and 160),
  subtitle text check (subtitle is null or char_length(subtitle) <= 280),
  description text check (description is null or char_length(description) <= 8000),
  cover_image_url text check (cover_image_url is null or char_length(cover_image_url) <= 1000),
  category_id uuid references public.university_categories(id) on delete set null,
  access_level public.university_access_level not null default 'authenticated',
  status public.university_course_status not null default 'draft',
  position integer not null default 0,
  lesson_count integer not null default 0,             -- denormalized; maintained by trigger
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index university_courses_catalog_idx on public.university_courses (status, position, created_at desc) where status = 'published';
create index university_courses_access_idx  on public.university_courses (access_level) where status = 'published';
create trigger university_courses_set_updated_at before update on public.university_courses for each row execute function public.set_updated_at();

create table public.university_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.university_courses(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 2000),
  provider public.university_video_provider not null,  -- public; not the source
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  position integer not null default 0,
  is_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, slug),
  unique (course_id, position) deferrable initially deferred   -- allows transactional reorder
);
create index university_lessons_course_position_idx on public.university_lessons (course_id, position);
create trigger university_lessons_set_updated_at before update on public.university_lessons for each row execute function public.set_updated_at();

-- THE PROTECTED TABLE — playable identity only.
create table public.university_lesson_sources (
  lesson_id uuid primary key references public.university_lessons(id) on delete cascade,
  course_id uuid not null references public.university_courses(id) on delete cascade,  -- denormalized for join-free entitlement
  provider public.university_video_provider not null,
  provider_video_id text check (provider_video_id is null or char_length(provider_video_id) <= 200),
  provider_hash text check (provider_hash is null or char_length(provider_hash) <= 200),
  source_path text check (source_path is null or char_length(source_path) <= 1000),     -- imagekit path
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger university_lesson_sources_set_updated_at before update on public.university_lesson_sources for each row execute function public.set_updated_at();

create table public.university_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.university_lessons(id) on delete cascade,
  course_id uuid not null references public.university_courses(id) on delete cascade,
  resume_seconds integer not null default 0 check (resume_seconds >= 0),
  completed_at timestamptz,
  last_watched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index university_progress_user_course_idx on public.university_progress (user_id, course_id);
create trigger university_progress_set_updated_at before update on public.university_progress for each row execute function public.set_updated_at();

-- RLS
alter table public.university_categories      enable row level security;
alter table public.university_courses         enable row level security;
alter table public.university_lessons         enable row level security;
alter table public.university_lesson_sources  enable row level security;
alter table public.university_progress        enable row level security;

create policy university_categories_public_read on public.university_categories for select to anon, authenticated using (true);
create policy university_categories_superadmin_write on public.university_categories for all to authenticated using (public.current_role()='superadmin') with check (public.current_role()='superadmin');

create policy university_courses_public_read on public.university_courses for select to anon, authenticated using (status = 'published');
create policy university_courses_superadmin_read on public.university_courses for select to authenticated using (public.current_role()='superadmin');
create policy university_courses_superadmin_write on public.university_courses for all to authenticated using (public.current_role()='superadmin') with check (public.current_role()='superadmin');

create policy university_lessons_public_read on public.university_lessons for select to anon, authenticated
  using (exists (select 1 from public.university_courses c where c.id = university_lessons.course_id and c.status='published'));
create policy university_lessons_superadmin_all on public.university_lessons for all to authenticated using (public.current_role()='superadmin') with check (public.current_role()='superadmin');

-- THE WALL: RLS enabled, NO policies, and revoke default grants.
revoke all on public.university_lesson_sources from anon, authenticated;

create policy university_progress_owner_all on public.university_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- lesson_count denormalization trigger
create or replace function public.university_sync_lesson_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_course uuid := coalesce(new.course_id, old.course_id);
begin
  update public.university_courses c
    set lesson_count = (select count(*) from public.university_lessons l where l.course_id = v_course)
  where c.id = v_course;
  return null;
end; $$;
create trigger university_lessons_count_aiud
  after insert or delete or update of course_id on public.university_lessons
  for each row execute function public.university_sync_lesson_count();
```

### Migration 3 — `20260610000200_university_rpcs.sql` (playback, progress, reorder, admin upsert)
- `get_lesson_playback(p_lesson_id uuid)` — definer; entitlement gate per §6 truth table; returns
  `(lesson_id, provider, provider_video_id, provider_hash, source_path)`; empty for unauthorized /
  unknown / unpublished (non-superadmin). `revoke all from public; grant execute to anon, authenticated`.
- `upsert_lesson_progress(p_lesson_id uuid, p_resume_seconds int, p_complete bool default false)` —
  definer; re-checks entitlement before writing; clamps `resume_seconds` to `duration_seconds`;
  completion is sticky (`completed_at = coalesce(existing, new)`). `grant execute to authenticated`.
- `university_reorder_lessons(p_course_id uuid, p_lesson_ids uuid[])` — definer; rewrites `position`
  inside one transaction (deferred unique makes naive 0..n-1 assignment safe); superadmin-gated
  (`raise` if not). `grant execute to authenticated` (re-checks role inside) OR call via service role.
- `superadmin_upsert_lesson(...)` — definer; writes the `university_lessons` row **and** its
  `university_lesson_sources` row atomically, keeping `course_id` denormalization consistent;
  superadmin-gated. `grant execute to service_role`.

> After applying: run `mcp__supabase__get_advisors` (security lint) to confirm
> `university_lesson_sources` exposes no anon/authenticated read path.

### `src/lib/university/*` file plan
```
src/lib/university/
  types.ts      # enums + DTOs/VMs: CourseCardVM, LessonRowVM, CourseDetailVM, ResumeVM, LessonPlayback
  access.ts     # isSubscriber(session) / canAccessCourse() / getEntitlement()  — mirrors §6 truth table
  embed.ts      # buildEmbedUrl(provider,{videoId,hash}) → string|null  (imagekit → null; pure, unit-tested)
  providers.ts  # parseProviderRef / validateProviderRef / normalize — SHARED client+server (CMS + write routes)
  data.ts       # public read DAL (ANON cookie client + unstable_cache): listPublishedCourses / getCourseDetail / loadLessonContext — NEVER selects sources
  playback.ts   # getLessonPlayback(lessonId) — server-only; cookie client → RPC; signs ImageKit URL with IMAGEKIT_PRIVATE_KEY
  progress.ts   # getCourseProgress(userId,courseId), per-lesson resume — server-only
  admin.ts      # superadmin write DAL (service-role) for CMS route handlers (the only source-writer)
```

`getSession()` change (`src/lib/auth/get-session.ts`): add `subscriptionTier:'free'|'pro'` to
`SessionContext`; select `subscription_tier` in the profile query; default `'free'`.

---

## 9. Progress tracking design

- **Model:** `university_progress(user_id, lesson_id)` PK; `course_id` denormalized for fast
  per-course rollups; `resume_seconds`; `completed_at` (null = incomplete); `last_watched_at`.
  Owner-only RLS; all writes go through `upsert_lesson_progress` (definer + entitlement re-check +
  clamp) so a user can't record progress on a gated lesson they can't watch.
- **Write path:** client tracks `currentTime`; throttled to **≤1 write / 10s** per lesson; always
  flush on `pause` / `visibilitychange→hidden` / `pagehide` (prefer `sendBeacon`). At ≥90% → optimistic
  complete; explicit "Mark complete" is the fallback. Bounded writes keep hundreds of concurrent
  viewers cheap (matches the repo's scaling posture).
- **Read path (`getCourseProgress`):** one round-trip → `total` lessons, `completed` count,
  `resume_lesson_id` (most recent incomplete by `last_watched_at`). **Course % = completed / total**
  (0 if total=0). **Resume** = `resume_lesson_id` at its `resume_seconds`; else first incomplete at 0s;
  else first lesson. **Continue rail** = most recent incomplete rows joined to course.
- **Surfaces:** catalog cards (green hairline + completed badge), detail CTA (states E/F + per-lesson
  ◐/✓), player sidebar (overall bar + per-lesson glyphs + resume seek). **Anon = no progress UI / no
  writes**; player shows "log in to track progress."

---

## 10. Video-provider embedding

The single place provider ids become URLs is `embed.ts` (pure, unit-tested). Superadmin form stores
**normalized ids** (parsed from a pasted URL via `providers.ts` + zod-validated) so we never render
an attacker-controlled URL.

| Provider | CMS input accepts | Stored `provider_ref` | Embed src (player) |
|---|---|---|---|
| `youtube`  | full URL or 11-char ID | normalized 11-char id → `provider_video_id` | `https://www.youtube-nocookie.com/embed/{id}?rel=0&modestbranding=1` |
| `vimeo`    | URL or numeric ID (+ unlisted hash) | numeric id → `provider_video_id`, hash → `provider_hash` | `https://player.vimeo.com/video/{id}{?h=hash}` |
| `loom`     | share URL or share ID | share id → `provider_video_id` | `https://www.loom.com/embed/{id}` |
| `imagekit` | full ImageKit video URL | file path → `source_path` | native `<video src={signedUrl}>` |

- **YouTube/Vimeo/Loom** = "embed-grade" privacy at best (a shared embed URL is technically
  replayable). Fine for `public`/`authenticated` courses.
- **ImageKit** = the only **truly private** option: `playback.ts` mints a short-lived **signed URL**
  (`getImageKit().url({ path, signed:true, expireSeconds: 1800 })`) and returns `expiresAt`. The
  player re-requests playback on `error`/near-expiry. **Recommend ImageKit for `subscriber` courses
  that must stay private.** (Future hardening: signed YouTube/Vimeo domains, DRM — out of scope v1.)

---

## 11. Build plan (exact file paths)

### foundationFiles (data + access + libs — build first)
```
supabase/migrations/20260610000000_profiles_subscription_tier.sql
supabase/migrations/20260610000100_university_schema.sql
supabase/migrations/20260610000200_university_rpcs.sql
src/lib/university/types.ts
src/lib/university/access.ts
src/lib/university/embed.ts
src/lib/university/providers.ts
src/lib/university/data.ts
src/lib/university/playback.ts
src/lib/university/progress.ts
src/lib/university/admin.ts
src/lib/university/access.test.ts        # entitlement parity vs §6 table
src/lib/university/embed.test.ts          # url shapes; imagekit→null; malicious-id rejection
src/app/university/actions.ts             # saveProgressAction / markLessonCompleteAction
```

### publicFiles (learner UI)
```
src/app/university/layout.tsx
src/app/university/page.tsx
src/app/university/_components/UniversityShell.tsx
src/app/university/_components/CatalogClient.tsx
src/app/university/_components/CourseCard.tsx
src/app/university/_components/AccessBadge.tsx
src/app/university/_components/ProgressBar.tsx
src/app/university/_components/ProgressRing.tsx
src/app/university/_components/ContinueRail.tsx
src/app/university/_components/CurriculumList.tsx       # SHARED detail+player
src/app/university/_components/UpsellCard.tsx
src/app/university/[courseSlug]/page.tsx
src/app/university/[courseSlug]/not-found.tsx
src/app/university/[courseSlug]/_components/CourseDetailClient.tsx
src/app/university/[courseSlug]/_components/CtaPanel.tsx
src/app/university/[courseSlug]/[lessonSlug]/page.tsx
src/app/university/[courseSlug]/[lessonSlug]/_components/LessonPlayer.tsx
src/app/university/[courseSlug]/[lessonSlug]/_components/PlayerSidebar.tsx
src/app/university/[courseSlug]/[lessonSlug]/_components/LockScreen.tsx
```

### adminFiles (superadmin CMS)
```
src/app/(app)/dashboard/university/page.tsx
src/app/(app)/dashboard/university/loading.tsx
src/app/(app)/dashboard/university/new/page.tsx
src/app/(app)/dashboard/university/[courseId]/edit/page.tsx
src/app/(app)/dashboard/university/_components/CourseList.tsx
src/app/(app)/dashboard/university/_components/CourseRowMenu.tsx
src/app/(app)/dashboard/university/_components/DeleteCourseModal.tsx
src/app/(app)/dashboard/university/_components/CourseEditor.tsx
src/app/(app)/dashboard/university/_components/LessonList.tsx
src/app/(app)/dashboard/university/_components/LessonRow.tsx
src/app/(app)/dashboard/university/_components/EmbedPreview.tsx
src/app/(app)/dashboard/university/_components/_lib/queries.ts
src/app/(app)/dashboard/university/actions.ts
src/app/api/superadmin/university/courses/route.ts                 # POST create
src/app/api/superadmin/university/courses/[id]/route.ts            # PATCH / DELETE
src/app/api/superadmin/university/courses/[id]/status/route.ts     # POST publish/unpublish/archive
src/app/api/superadmin/university/courses/[id]/reorder/route.ts    # POST
src/app/api/superadmin/university/lessons/route.ts                 # POST create lesson+source
src/app/api/superadmin/university/lessons/[id]/route.ts            # PATCH / DELETE
src/app/api/superadmin/users/[id]/tier/route.ts                    # POST tier toggle
src/app/(app)/dashboard/_components/UserTierToggle.tsx             # NEW client toggle
```

### sharedEdits (existing files to modify)
```
src/app/globals.css                                  # + [data-university-root] (§2) and [data-university-admin] (§5.5) blocks
src/lib/auth/get-session.ts                          # + subscriptionTier on SessionContext + select
src/app/(app)/_components/sidebar.tsx                # + 'university' icon + requiresSuperadmin nav item + filter clause
src/app/(app)/dashboard/_components/SuperadminDashboard.tsx  # + TIER column + select subscription_tier + <UserTierToggle/>
```

### Suggested build order
1. foundationFiles (migrations → run `get_advisors` → libs → action stubs → tests).
2. `get-session.ts` edit + sidebar edit (unlocks superadmin nav).
3. publicFiles: layout/tokens → `CourseCard`/`AccessBadge`/`ProgressBar` → catalog → `CurriculumList`
   → detail + `CtaPanel` → player + `LockScreen` + progress wiring.
4. adminFiles: list → editor + lessons + providers preview → route handlers → tier toggle.

---

## 12. Open questions for the product owner

1. **Pricing & checkout.** Billing is forward-compatible per the locked decision but no price or
   checkout exists. Where should "Subscribe to unlock" / "See Pro" point in v1 — a static
   `/university/pricing` page, a contact form, or a stubbed route — and what monthly price string
   should the CTA panel show (currently `₱ ___ /mo`)?
2. **Categories: managed table vs free-text.** Doc A assumes a `university_categories` admin-managed
   table (included above); doc B/03 lean toward free-text. Keep the categories table + a CMS editor,
   or ship v1 with a free-text `category` column and add the table later?
3. **Auto-advance default.** Should the player's "Up next" auto-advance be **on by default**
   (B's momentum model) or **opt-in** (calmer, A's tone)? Affects default UX and a possible
   per-user preference.
4. **Draft preview tokens.** The CMS "Preview (public)" action for draft/archived courses needs a
   signed-token mechanism on the public page. Reuse the existing action-page deeplink token scheme,
   or is superadmin-session-based preview (no token, just check the cookie session) acceptable?
