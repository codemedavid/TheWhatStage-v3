# Chatbot Primary Goal — Design

**Date:** 2026-05-13
**Status:** Approved (brainstorming phase)

## Problem

The chatbot today answers whatever a lead asks, and recommends action pages purely from message intent (see `src/lib/chatbot/recommend.ts` and `classify.ts`). When a conversation is open-ended or winding down, the bot has no concept of where to *lead* the customer. Users with a single action page implicitly want the bot to drive customers there; users with multiple pages want to pick a primary one.

We need a soft "primary goal" the bot can steer toward without overriding genuine intent, plus an unobtrusive way to set/replace it as users publish new action pages.

## Goals

- One primary goal action page per user, configured on the chatbot.
- Bot gently steers open-ended turns toward the goal; intent matching for other pages stays unchanged.
- Campaign-level funnel instructions still win when set (existing behavior preserved).
- When a user publishes their first published action page and has no goal set, the goal is auto-assigned silently.
- When a user publishes a subsequent published action page, they are offered the option to make it (or replace the current) primary goal.

## Non-goals

- Hard-routing — bot will not force the goal page onto every conversation.
- Modifying the action-page recommendation/matching pipeline (`recommend.ts`, `classify.ts`).
- Per-channel or per-template goals (single global goal per user for v1).
- A separate "publish?" confirmation on create — the editor's existing publish toggle is the publish gesture.

## Data Model

Add one column to `chatbot_configs`:

```sql
alter table chatbot_configs
  add column primary_action_page_id uuid
    references action_pages(id) on delete set null;
```

- Nullable. `on delete set null` so deleting a page does not break the bot.
- Table is keyed by `user_id`, so this is naturally "one primary goal per user."
- No schema change to `action_pages`.

`ChatbotConfig` (TS) gains `primaryActionPageId: string | null`. Parsed in `rowToConfig` (`src/lib/chatbot/config.ts`); written by `upsertChatbotConfig` and by the new `setPrimaryActionPage` server action.

## Steering Behavior

Precedence for the existing `# PRIMARY GOAL` block in `buildPrompt` (see `src/lib/rag/prompt-builder.ts:82`):

1. Campaign funnel instruction (`campaignPersona.funnelInstruction`) — wins if set.
2. **Chatbot primary goal** (new) — used when no campaign override.
3. Nothing — section omitted.

When (2) applies, the goal text is built from the primary action page:

```
Your primary goal is to guide the conversation toward sharing this page with
the customer when it fits naturally:

Page: {title}
Link: {public_url_for_slug}
{bot_send_instructions ? "When to send / what to say:\n" + bot_send_instructions : ""}

Continue answering the customer's actual questions first. When the conversation
is open-ended, winding down, or the customer asks generally about what you
offer, steer toward this page. Do not force it if the customer's intent clearly
points elsewhere.
```

### Implementation

- New helper `src/lib/chatbot/primary-goal.ts` exporting:
  ```ts
  export async function loadPrimaryGoalInstruction(
    supabase: SupabaseClient,
    userId: string,
  ): Promise<string | null>
  ```
  Joins `chatbot_configs.primary_action_page_id` → `action_pages` filtered by `status='published'`. Returns the formatted string, or `null` when no goal is set, the page was deleted, or the page is no longer published.
- `answer.ts` calls `loadPrimaryGoalInstruction` after `getChatbotConfig` and feeds the result into the same `funnelInstruction` slot of `buildPrompt`, **only when** `campaignPersona?.funnelInstruction` is absent or empty.
- Existing per-page `recommendation_rules` and the recommend/classify pipelines remain unchanged.

## UI

### Chatbot settings page (`/dashboard/chatbot`)

- New "Primary goal" section above existing personality settings.
- Dropdown of the user's `status='published'` action pages plus a "None" option.
- Helper text: "When set, your chatbot will gently steer open-ended conversations toward this page. Campaign-specific goals override this."
- Saved via the chatbot settings server action (extended to accept `primaryActionPageId`).

### Action-pages list (`/dashboard/action-pages`)

- Small "Primary goal" badge on the row currently set as the goal.
- Row action "Set as primary goal":
  - Enabled for `status='published'` pages.
  - Disabled for drafts with tooltip "Publish to use as primary goal".
- Action invokes a new server action `setPrimaryActionPage(actionPageId | null)` in `src/app/(app)/dashboard/chatbot/actions.ts`. The action updates `chatbot_configs.primary_action_page_id` and `revalidatePath`s both `/dashboard/chatbot` and `/dashboard/action-pages`.

## New-Action-Page Publish Prompt

Triggered the **first** time a page transitions from `draft` → `published`. Detection lives in the existing update path in `src/app/(app)/dashboard/action-pages/actions/crud.ts` (compare current `status` to new `status` before the update).

After a successful publish:

| Current state | Behavior |
| --- | --- |
| User has no primary goal set, and this is their only `published` page | Silently set this page as the primary goal. No banner. |
| User has no primary goal set, other `published` pages exist | Redirect to editor with `?just_published=1&offer_primary=1`. Dismissible banner: "This page is published. Make it your chatbot's primary goal?" Buttons: **Set as primary goal**, **Not now**. |
| User has a primary goal set to a different page | Redirect with `?just_published=1&offer_primary=switch`. Banner: "This page is published. Replace your current primary goal ('{current title}') with this one?" Buttons: **Replace**, **Keep current**. |
| User has a primary goal set to this page already | No banner. |

Banner component lives in `src/app/(app)/dashboard/action-pages/_components/PublishedPrimaryGoalBanner.tsx`, reads search params, calls `setPrimaryActionPage`, and on dismiss removes the params via `router.replace`.

## Edge Cases

- Primary goal page is later set back to `draft` or deleted: `loadPrimaryGoalInstruction` returns `null` (silent fallthrough). The settings dropdown reflects "None" because the page is excluded from the published list. (`on delete set null` handles the delete case at the DB level.)
- Concurrent edits: `setPrimaryActionPage` is a simple update keyed by `user_id`; last write wins, which is acceptable for a single-user-controlled setting.
- Campaign override: when a lead is in a campaign with `funnelInstruction`, the campaign's goal still wins (existing logic preserved).

## Files Touched

- **DB migration:** new SQL file adding `primary_action_page_id` to `chatbot_configs`.
- `src/lib/chatbot/config.ts` — extend types, `rowToConfig`, `DEFAULT_CHATBOT_CONFIG`, and the upsert path.
- `src/lib/chatbot/primary-goal.ts` — new helper.
- `src/lib/chatbot/answer.ts` — call helper, feed into prompt when no campaign override.
- `src/app/(app)/dashboard/chatbot/actions.ts` — extend settings save; add `setPrimaryActionPage`.
- `src/app/(app)/dashboard/chatbot/page.tsx` and chatbot `_components` — primary goal dropdown.
- `src/app/(app)/dashboard/action-pages/page.tsx` (or list component) — badge + row action.
- `src/app/(app)/dashboard/action-pages/actions/crud.ts` — detect draft→published transition, apply auto-default vs. redirect-with-prompt logic.
- `src/app/(app)/dashboard/action-pages/_components/PublishedPrimaryGoalBanner.tsx` — new banner component.

## Testing

- Unit: `loadPrimaryGoalInstruction` — returns `null` when unset, deleted, or non-published; returns formatted string when published; ensures `bot_send_instructions` is included only when non-empty.
- Unit: precedence in `answer.ts` — campaign override wins over chatbot goal; chatbot goal used when no override; neither set produces no goal section.
- Integration: draft→published transition matrix (4 cases above) sets `chatbot_configs.primary_action_page_id` correctly or redirects with the right query string.
- Manual: end-to-end in the chatbot test harness — verify the bot mentions the goal page on an open-ended question and does not force it when intent is clearly elsewhere.
