# Onboarding Wizard — Design

**Status:** Draft for review
**Date:** 2026-05-15
**Owner:** John Angelo David

## Goal

Help a freshly signed-up user launch a working chatbot + action page in one guided session by collecting a small number of inputs and letting AI fill in the rest. The wizard is fully skippable; the same steps are mirrored as a dashboard launch checklist so users can finish at their own pace.

## Non-goals (v1)

- Multi-business / agency mode
- Editing onboarding language after completion (handled in existing chatbot settings)
- Dashboard tour / tooltips
- A/B testing wizard copy
- Analytics events (added later as a thin hook)

## Shape of the flow

Post-signup the auth action redirects to `/onboarding/welcome`. The user can dismiss the wizard at any time (`Skip for now` in header → `/dashboard`). The same eight steps appear on the dashboard as a **Launch Checklist** card. State is shared, so re-entering the wizard or clicking a checklist item resumes mid-flow.

### Step list

| # | Route | Step | What happens |
|---|---|---|---|
| 0 | `/onboarding/welcome` | Welcome + language confirm | Default TL, EN toggle. Toggle also seeds AI output language. |
| 1 | `/onboarding/business` | Business basics (~6 fields) | Name, one-line offer, business type, target customer, pain solved, tone preset. |
| 2 | `/onboarding/knowledge` | AI-generated knowledge preview | AI writes 4–6 sections from step-1 inputs → editable preview → save. |
| 3 | `/onboarding/faqs` | Hybrid FAQ checklist | 5–8 AI suggestions pre-checked, add own, skip. |
| 4 | `/onboarding/personality` | Vibe preset + 3 short prompts | All skippable. AI-generated personality config + rules auto-save (no preview gate). |
| 5 | `/onboarding/goal` | Pick #1 goal | 6 goal cards → maps to `ActionPageKind`, creates starter page from `KIND_REGISTRY` defaults, sets `chatbot.primary_action_page_id`. |
| 6 | `/onboarding/goal-content` | Goal-specific light content | Catalog → 1–3 products; sales → product details; booking → confirm hours; realestate → 1 property; form/qualification → AI-proposed fields, user confirms. All skippable. |
| 7 | `/onboarding/flow` | Conversation flow → AI bot instructions | User describes ideal customer convo in plain language. AI generates `bot_send_instructions`, recommendation rules, primary-goal prompt — editable preview before save. |
| 8 | `/onboarding/done` | Test your bot | "Open chatbot tester" + "Go to dashboard". Marks `onboarding_state.completed_at`. |

### Shared wizard shell

- Progress bar (step N of 8)
- EN/TL toggle in header (default TL)
- `Skip for now` → dashboard, leaves checklist visible
- `Skip this step` → next step, marks step `*_completed_at` with the `skipped_steps` audit entry
- Back button always works; completed steps are re-enterable and pre-filled

### Dashboard launch checklist

`src/app/(app)/dashboard/_components/LaunchChecklist.tsx` server-renders from `onboarding_state`. Each item is a `Link` to its `/onboarding/<step>` route. The card hides once `completed_at` or `dismissed_at` is set. A `/dashboard/settings` toggle ("Show launch checklist") re-enables it by clearing `dismissed_at`.

## Data model

### New table — `onboarding_state`

One row per profile, created in the signup server action.

```sql
create table onboarding_state (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- step progress (null = not done; timestamp = completed OR skipped)
  business_completed_at timestamptz,
  knowledge_completed_at timestamptz,
  faqs_completed_at timestamptz,
  personality_completed_at timestamptz,
  goal_completed_at timestamptz,
  goal_content_completed_at timestamptz,
  flow_completed_at timestamptz,
  -- terminal states
  completed_at timestamptz,
  dismissed_at timestamptz,
  -- captured inputs (raw, kept so we can regenerate later)
  business_basics jsonb,           -- { name, offer, type, audience, pain, tone, ui_lang }
  faq_seeds jsonb,                 -- user-added FAQs (raw)
  personality_seeds jsonb,         -- { vibe_preset, greet, must_use, must_not }
  flow_description text,           -- user's "ideal conversation flow" answer
  -- generation metadata
  ai_generations jsonb default '[]'::jsonb,  -- [{step, model, prompt_hash, at, skipped}]
  ui_language text default 'tl' check (ui_language in ('tl','en')),
  customer_language text default 'tl' check (customer_language in ('tl','en')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table onboarding_state enable row level security;
-- RLS: profile_id = auth.uid()
```

Backfill migration: for every existing profile, insert `onboarding_state` with `completed_at = now()` so pre-launch users never see the wizard.

### Existing tables touched (no schema changes)

- `knowledge` / `faqs` — AI-generated content inserted on step 2/3 save
- `chatbot` — `personality_config` + rules updated on step 4; `primary_action_page_id` set on step 5; `bot_send_instructions` + recommendation rules updated on step 7; `primary_goal` updated on step 7
- `action_pages` — starter row inserted on step 5 from `KIND_REGISTRY` defaults
- `business_items` — products inserted on step 6 (catalog); property inserted on step 6 (realestate)
- `profiles` — no change; UI language lives in a cookie (`ws_onboarding_lang`) for resumability

### Resume rule

Layout under `/onboarding/*` loads `onboarding_state`. Completed steps stay re-enterable and pre-fill from `onboarding_state` + the destination tables. Re-running an AI step shows a "Regenerate (replaces current)" confirmation before overwriting.

## AI generation

All AI calls use the project's existing `HfRouterLlm` client (`@/lib/rag`, OpenAI-compatible against OpenRouter/HF router) — same pattern as `src/lib/chatbot/classify.ts`, `answer.ts`, `deep-reclassify.ts`.

- Default model `HfRouterLlm()` for prose generations (knowledge, FAQs, bot instructions).
- `ragConfig.classifierModel` for structured short outputs (personality config, form fields).
- JSON output via `responseFormat: 'json_object'` + strict schema in the system prompt.
- All generators are pure functions; server actions own DB writes.
- AI only fires on form submit, never on page load.
- Tests mock `HfRouterLlm` the same way `classify.test.ts` does.

### Generator contracts

```ts
// src/lib/onboarding/ai/knowledge.ts
generateKnowledge(input: {
  basics: BusinessBasics
  lang: 'tl' | 'en'
}): Promise<{ sections: { title: string; body: string }[] }>  // 4–6 sections

// src/lib/onboarding/ai/faqs.ts
generateFaqs(input: {
  basics: BusinessBasics
  lang: 'tl' | 'en'
}): Promise<{ suggestions: { question: string; answer: string }[] }>  // 5–8 items

// src/lib/onboarding/ai/personality.ts
generatePersonality(input: {
  basics: BusinessBasics
  seeds: { vibe_preset?: string; greet?: string; must_use?: string; must_not?: string }
  lang: 'tl' | 'en'
}): Promise<{
  personality_config: ChatbotPersonalityConfig  // matches existing personality-actions.ts schema
  rules: { kind: 'do' | 'dont'; text: string }[]
}>

// src/lib/onboarding/ai/bot-instructions.ts
generateBotInstructions(input: {
  basics: BusinessBasics
  goal: ActionPageKind
  action_page_snapshot: { id: string; title: string; cta_label: string }
  flow_description: string
  lang: 'tl' | 'en'
}): Promise<{
  bot_send_instructions: string
  recommendation_rules: { trigger: string; action: string }[]  // matches chatbot_recommendation_rules
  primary_goal_prompt: string
}>

// src/lib/onboarding/ai/form-fields.ts  (form / qualification kinds only)
generateFormFields(input: {
  basics: BusinessBasics
  goal: 'form' | 'qualification'
  lang: 'tl' | 'en'
}): Promise<{ fields: ActionPageBlock[] }>
```

### Error handling

Generation failures throw a typed error → server action returns `{ error: 'generation_failed' }` → step page renders inline error with **Retry**, **Skip this step**, and a **Write it manually** link to the underlying editor. Never silent, never auto-retry.

## File structure

```
src/app/(app)/onboarding/
  layout.tsx                       # shell: progress bar, EN/TL toggle, skip
  loading.tsx
  actions.ts                       # all server actions, one per step
  _components/
    WizardShell.tsx
    LangToggle.tsx                 # writes ws_onboarding_lang cookie + revalidatePath
    StepNav.tsx
    AIPreviewEditor.tsx            # editable AI output, save/regenerate
    BusinessTypeCards.tsx
    GoalCards.tsx
    VibePresetPicker.tsx
  welcome/page.tsx
  business/page.tsx + BusinessForm.tsx
  knowledge/page.tsx
  faqs/page.tsx + FaqChecklist.tsx
  personality/page.tsx + PersonalityForm.tsx
  goal/page.tsx
  goal-content/page.tsx            # branches on chatbot.primary_action_page.kind
  flow/page.tsx + FlowForm.tsx
  done/page.tsx

src/app/(app)/dashboard/_components/
  LaunchChecklist.tsx              # reads onboarding_state, server-rendered

src/lib/onboarding/
  state.ts                         # getOnboardingState, markStep, dismiss, complete
  steps.ts                         # ordered step metadata
  i18n.ts                          # tiny in-repo dict (tl/en), t(key, lang)
  ai/
    knowledge.ts
    faqs.ts
    personality.ts
    bot-instructions.ts
    form-fields.ts
```

## Server actions

`src/app/(app)/onboarding/actions.ts`:

```ts
setLang(lang)
saveBusinessBasics(input)
generateAndSaveKnowledge()         // first-time generation, server-rendered preview path
saveKnowledgeEdits(sections)       // save edited preview
regenerateKnowledge()              // returns preview, does not save
saveFaqs(selected, custom)
generatePersonality(seeds)         // auto-saves (no preview gate)
saveGoal(kind)
saveGoalContent(payload)           // kind-aware; routes to the right write
generateBotInstructions(flowDescription)  // returns preview
saveBotInstructions(payload)
markStepSkipped(step)
dismissOnboarding()
completeOnboarding()
```

Validation: Zod schema per action input. Reuse existing action-page config schemas where applicable. All actions resolve `profile_id` from session; writes are scoped via RLS.

## i18n approach

No `next-intl` / `i18next`. The toggle is the only multi-language surface; a tiny in-repo dict is enough:

```ts
// src/lib/onboarding/i18n.ts
export const dict = {
  'business.name.label': { tl: 'Ano pangalan ng business mo?', en: "What's your business name?" },
  // ...
} as const
export type OnboardingLang = 'tl' | 'en'
export function t(key: keyof typeof dict, lang: OnboardingLang) { return dict[key][lang] }
```

- Cookie `ws_onboarding_lang` read in the wizard layout (server component), passed as prop.
- Toggle is a `<form>` posting to `setLang` which sets the cookie and revalidates `/onboarding`. Pure server, no client state.
- AI generators receive `lang` so output matches what the user is reading.
- Dashboard checklist reads the same cookie to label itself.
- Default `lang = 'tl'`.

## Client/server split

The wizard is server-rendered. The **only** client component is `AIPreviewEditor` (used by knowledge, FAQs, flow) — needs local edit state. Everything else (forms, cards, toggle) is server components + form actions.

## Edge cases

| Case | Handling |
|---|---|
| Refresh mid-step | Form state in URL/server; pre-fill from `onboarding_state` |
| Two tabs open | Last write wins; `updated_at` is informational |
| AI timeout/error | Inline error + Retry + Skip + manual-edit link |
| Pre-launch users | Backfill migration sets `completed_at = now()` |
| Dismiss then want it back | Dashboard setting clears `dismissed_at` |
| Lang toggle mid-step | Revalidates; form keeps user-typed values, re-renders with new labels |
| Goal step re-entered with different kind | Creates new action page, updates `primary_action_page_id`. Old page kept as draft. |
| Catalog with 0 products | Allowed; page stays draft; flow continues. |
| Malformed AI JSON | Caught in generator → typed error → server action error → UI retry |

## Testing

- Unit tests for `src/lib/onboarding/ai/*` mocking `HfRouterLlm`, asserting prompt structure and parsed output shape.
- Server-action integration tests verifying the right tables get written for each step (especially step 5 creating the action page + setting `primary_action_page_id`, step 6 branching by kind, step 7 writing both `bot_send_instructions` and recommendation rules).
- A few i18n smoke tests confirming TL labels render when the cookie is set.

## Open questions

None blocking. Possible follow-ups after v1:
- Adding an analytics hook to `actions.ts`
- Onboarding language editor in chatbot settings
