# Facebook Comments Management

**Date:** 2026-05-01
**Status:** Proposed

## Background

The app already has per-user Facebook connections, encrypted Page access tokens,
Page webhook verification, Messenger ingestion, a Messenger worker queue, chatbot
answer generation, and a lead drawer with a Conversation tab. This feature
extends that foundation so connected Facebook Pages can automatically handle Page
comments without turning the product into a full comment archive.

Meta supports Page `feed` webhooks for comment changes. Comment objects expose
moderation capability fields such as `can_hide`, `can_remove`,
`can_reply_privately`, and `is_hidden`; comments can be updated, hidden by
setting `is_hidden`, or deleted through the Graph API when the Page token has
the required permissions.

## Goals

- Automatically moderate comments on connected Facebook Pages.
- Automatically hide or delete spam and abusive comments.
- Automatically reply to safe comments when the bot has a useful response.
- Automatically send a Messenger/private reply for question comments when Meta
  allows it.
- Attach comment activity to a lead only when there is a strict, same-Page
  identity match or when a Messenger private-reply bridge later resolves to an
  existing lead.
- Show lead-linked comment activity in Lead Management alongside Messenger
  conversation history.
- Avoid storing ordinary unrelated comments.

## Non-Goals

- Do not store every Page comment.
- Do not create leads from comments.
- Do not infer lead attachment from similar names, similar text, or fuzzy
  identity signals.
- Do not build a broad comment inbox in v1.
- Do not retain random positive comments after lightweight engagement.
- Do not guarantee private replies when Meta does not expose
  `can_reply_privately` or the Graph API rejects the action.

## Permissions and Meta Constraints

The existing OAuth flow requests Page management and Messenger permissions. For
comment moderation, the app must confirm that the connected Pages grant the
current permissions required by Meta, including comment management permission and
its dependencies. Current Meta documentation lists `pages_manage_engagement` for
creating, editing, and deleting Page comments, with dependencies that include
`pages_read_user_content` and `pages_show_list`. Webhook delivery for Page
activity requires `pages_manage_metadata`.

Implementation should treat Graph capability fields as the final authority:

- Delete only when `can_remove` is true and classification confidence is high.
- Hide when delete is not available but `can_hide` is true.
- Send a private reply only when `can_reply_privately` is true.
- Fall back to no destructive action when the capability fields are missing or
  the Graph call fails with a permissions/capability error.

## Retention Model

The webhook may inspect every relevant comment event, but long-term storage is
selective.

Persist a comment only when one of these is true:

1. The comment strictly matches an existing lead on the same Facebook Page.
2. The bot sends or attempts a Messenger/private reply because the comment is a
   question.
3. A temporary bridge record is needed so a later Messenger reply can connect
   the original comment to an existing lead.
4. A moderation action fails and a minimal failure record is needed for
   debugging.

Discard after processing:

- Random positive comments that are publicly answered or require no action but
  do not match a lead.
- Spam or abusive comments that are successfully hidden/deleted and do not match
  a lead.
- Non-question comments with no lead match and no failed Graph action.

Bridge records that never resolve to a lead should expire automatically after a
short retention window, defaulting to 30 days.

## Data Model

Add tables focused on work queue, lead-linked activity, and short-lived bridges.

### `facebook_comment_jobs`

Queue table for asynchronous comment processing.

Core columns:

- `id uuid primary key`
- `page_id uuid references facebook_pages(id) on delete cascade`
- `user_id uuid references auth.users(id) on delete cascade`
- `fb_comment_id text not null`
- `fb_parent_id text`
- `fb_post_id text`
- `webhook_event jsonb not null`
- `status text` in `queued`, `running`, `done`, `failed`, `skipped`
- `attempts integer`
- `scheduled_at timestamptz`
- `started_at timestamptz`
- `finished_at timestamptz`
- `last_error text`
- `created_at timestamptz`

Indexes:

- `(status, scheduled_at)` partial index for queued/running jobs.
- unique `(fb_comment_id)` or an equivalent idempotency key to avoid duplicate
  webhook retries.

Successful and skipped job rows are operational records, not long-term comment
retention. The worker or cleanup job should delete or compact them after they no
longer need retry/idempotency protection. Failed jobs may keep minimal error
context for debugging.

### `facebook_lead_comments`

Long-term lead-linked comment activity.

Core columns:

- `id uuid primary key`
- `lead_id uuid references leads(id) on delete cascade`
- `page_id uuid references facebook_pages(id) on delete cascade`
- `user_id uuid references auth.users(id) on delete cascade`
- `fb_comment_id text not null`
- `fb_post_id text`
- `fb_parent_id text`
- `commenter_id text`
- `commenter_name text`
- `message text not null default ''`
- `classification text` in `good`, `question`, `spam`, `abusive`,
  `needs_no_action`
- `confidence text` in `low`, `medium`, `high`
- `moderation_action text` in `none`, `public_reply`, `private_reply`, `hide`,
  `delete`
- `public_reply text`
- `private_reply text`
- `graph_status text` in `pending`, `sent`, `hidden`, `deleted`, `failed`,
  `skipped`
- `graph_error text`
- `created_at timestamptz`

Indexes:

- `(lead_id, created_at)`
- `(user_id, created_at desc)`
- unique `(fb_comment_id)`

### `facebook_comment_bridges`

Short-lived records that connect a private reply attempt to a future Messenger
thread if Meta identity permits.

Core columns:

- `id uuid primary key`
- `page_id uuid references facebook_pages(id) on delete cascade`
- `user_id uuid references auth.users(id) on delete cascade`
- `fb_comment_id text not null`
- `commenter_id text`
- `commenter_name text`
- `message text not null default ''`
- `private_reply_message_id text`
- `lead_id uuid references leads(id) on delete cascade`
- `resolved_at timestamptz`
- `expires_at timestamptz not null`
- `created_at timestamptz`

Indexes:

- `(page_id, commenter_id)` where `resolved_at is null`
- `(expires_at)` for cleanup
- unique `(fb_comment_id)`

### RLS

All new public tables have RLS enabled.

- Owners can read rows where `user_id = auth.uid()`.
- Owners should not directly insert queue/bridge rows from the browser; service
  role handles webhook and worker writes.
- Admin/superadmin may have read/write access consistent with existing Facebook
  support tables.

## Graph Helpers

Create `src/lib/facebook/comments.ts` with small, testable helpers:

- `fetchComment(pageAccessToken, commentId)` fetches message, author,
  parent/post ids, `can_hide`, `can_remove`, `can_reply_privately`, and
  `is_hidden`.
- `replyToComment(pageAccessToken, commentId, message)` posts a public reply.
- `sendPrivateCommentReply(pageAccessToken, commentId, message)` sends a
  Messenger/private reply when supported by Graph.
- `hideComment(pageAccessToken, commentId)` updates `is_hidden=true`.
- `deleteComment(pageAccessToken, commentId)` deletes the comment.

These helpers own all comment Graph URLs and parse Graph errors into stable
application errors.

## Classification

Create `src/lib/comments/classify.ts`.

The classifier returns strict JSON:

```json
{
  "category": "good|question|spam|abusive|needs_no_action",
  "confidence": "low|medium|high",
  "public_reply": "string|null",
  "private_reply": "string|null",
  "moderation_action": "none|public_reply|private_reply|hide|delete",
  "reason": "string"
}
```

Rules:

- `spam` covers scams, repeated promotion, malicious links, fake giveaways, and
  irrelevant commercial spam.
- `abusive` covers clear harassment, threats, profane attacks, hate, or unsafe
  content.
- Mild negative feedback is not abuse.
- Destructive action requires high confidence.
- If parsing fails or confidence is low, do nothing destructive.

## Workflow

1. Facebook sends a Page webhook payload.
2. Existing `src/app/api/webhooks/facebook/route.ts` verifies the signature.
3. The route continues processing Messenger events as today.
4. For Page `feed` comment changes, it identifies the local `facebook_pages`
   row and owner.
5. It ignores unsupported non-comment changes and Page-authored echo comments.
6. It inserts or upserts a `facebook_comment_jobs` row and returns 200 quickly.
7. A comment worker claims jobs in batches using the same pattern as Messenger.
8. The worker decrypts the Page token and fetches/enriches the comment.
9. The worker strictly attempts lead matching.
10. The worker classifies the comment.
11. The worker performs the Graph action:
    - Good/simple comment: optionally public reply, then discard unless
      lead-linked.
    - Question: public reply if safe, private reply when allowed, persist a
      lead-linked row or bridge record.
    - Spam/abuse: delete when allowed and high-confidence; otherwise hide when
      allowed; discard unless lead-linked or failed.
12. When a future Messenger message arrives from the same Page identity and
    resolves to an existing lead, unresolved bridge rows may be attached to that
    lead.

## Lead Matching

Attachment is strict only.

Allowed matches:

- Same Facebook Page and a Meta identity that maps to an existing
  `messenger_threads` row with a non-null `lead_id`.
- Same Facebook Page and a bridge that resolves through a later Messenger
  conversation that already links to a lead.

Disallowed matches:

- Matching by display name alone.
- Matching by comment text similarity.
- Matching across different Facebook Pages.
- Creating a new lead when no match exists.

If the system cannot prove the match, it leaves the comment unlinked and either
uses a temporary bridge or discards it according to the retention model.

## Lead Management UI

Extend the existing lead drawer Conversation tab.

The timeline should merge:

- Messenger messages.
- Lead stage events.
- Linked Facebook comments from `facebook_lead_comments`.

Comment timeline items show the original comment, Page/post context when
available, classification, and action status such as `replied privately`,
`hidden`, or `deleted`.

No broad comment management screen is required in v1.

## Error Handling and Safety

- If classification fails, do nothing destructive.
- If the comment is gone, mark the job skipped.
- If Graph denies access, mark skipped or failed depending on whether retrying
  can help.
- If `can_remove` is false but `can_hide` is true, hide instead of delete.
- If private reply is not allowed, fall back to a public reply only when the
  classifier produced a safe public answer.
- Retry transient Graph failures a small number of times.
- Persist minimal moderation failure records so failures can be debugged without
  archiving all comments.
- Make Graph actions idempotent enough that webhook retries do not send
  duplicate replies or repeat destructive actions unexpectedly.

## Testing

- Unit-test Page `feed` comment webhook parsing, ignored events, duplicate
  deliveries, and unknown pages.
- Unit-test classifier parsing, malformed JSON, low-confidence output, and
  destructive action gating.
- Unit-test Graph helpers with mocked `fetch`.
- Test retention rules:
  - unrelated good comments are discarded,
  - lead-linked comments persist,
  - question private-reply bridge records persist,
  - expired bridge records can be cleaned up.
- Test strict lead matching:
  - same-Page known identity attaches,
  - missing or ambiguous identity does not attach,
  - cross-Page identity does not attach.
- Test worker idempotency so a retried webhook does not duplicate replies or
  duplicate deletes.
- Test lead drawer loading so linked comments appear in the conversation
  timeline.

## Open Questions

None.
