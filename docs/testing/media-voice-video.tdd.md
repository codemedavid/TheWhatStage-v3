# TDD evidence: voice and video replies across the flow

**Source plan**: inline `/plan` output in the 2026-09-07 session (no `.plan.md` file).
**Branch**: `feat/media-voice-video` (worktree `WhatStage_V3-media`).
**Validation used**: `./node_modules/.bin/vitest run src/`, `./node_modules/.bin/tsc --noEmit -p .`, `./node_modules/.bin/eslint <touched files>`.

## User journeys
1. As an operator, I upload a voice message or video to the media library so the bot and my automations can send it.
2. As a lead, I get a text bubble followed by a voice note or video when it fits, never two heavy bubbles in one turn.
3. As an operator, I attach library media to auto follow-up touchpoints, project sequence steps, workflow send nodes and agent campaigns.

## Task report
| Phase | RED commit | GREEN commit | Guarantee |
|---|---|---|---|
| 0 core | `75eadd4` | `cf76cb8` | mime → kind mapping, shared `sendMediaAssets`, AV-aware RAG labels, migration |
| 1 library | `59f3d4b` | `98fa05f` | upload validation + direct-to-storage flow, AV previews, picker kinds filter |
| 2 chatbot | `7107aa6` | `597ded4` | `# Attached media` prompt block, one AV per turn, attachment-type dispatch in the worker |
| 3 flows | `845f3d2` | `2ed224f` | follow-up `media_asset_ids` (+legacy keys), sequence step media, workflow `media` payload |
| 4 campaigns | `5b3bcdb` | `eadc4df` | campaign media sent after text, inside the 24h window only |

## Test specification
| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | Only playable voice (mp3/m4a/wav) and video (mp4/mov) mimes are accepted; caps ≤ 25 MB | `src/lib/media/kind.test.ts` | unit | PASS |
| 2 | Shared send signs URLs, dispatches by kind, persists inbox rows, stops on policy block, survives per-asset failures | `src/lib/media/send.test.ts` | unit | PASS |
| 3 | RAG text labels voice/video assets by kind | `src/lib/media/rag-text.test.ts` | unit | PASS |
| 4 | Upload batches are validated per kind, sized, and capped at 20 files | `src/lib/media/upload.test.ts` | unit | PASS |
| 5 | Prompt block tees up voice/video naturally | `src/lib/media/prompt.test.ts` | unit | PASS |
| 6 | At most one voice/video per turn | `src/lib/media/turn-cap.test.ts` | unit | PASS |
| 7 | Worker sends by attachment type; voice + image + video → audio, image | `src/app/api/messenger/process/route.test.ts` | integration | PASS |
| 8 | Follow-ups send audio payloads and still honor legacy image keys | `src/lib/followups/fire.test.ts`, `settings.test.ts`, `attachments.test.ts` | unit | PASS |
| 9 | Sequence step media sent after text inside the window, skipped outside | `src/lib/projects/sequences/fire.test.ts` | unit | PASS |
| 10 | Workflow `media` payload → success / policy_blocked / error edges | `src/lib/workflow/executor.test.ts` | unit | PASS |
| 11 | Campaign media never throws, skips outside window | `src/lib/messenger/campaignMedia.test.ts` | unit | PASS |

## Coverage and known gaps
- Final run: `vitest run src/` → 2141 passed, 2 failed. Both failures pre-exist on `main` (`executor.test.ts` utility_template render, `action-pages/submit` CAPI test) and are unrelated.
- No coverage run (no coverage script configured in the repo).
- Not covered by automated tests: the browser upload helper (`client-upload.ts`), React components, and the two API routes for upload intent/complete. A live Messenger send of an mp3/m4a asset has not been verified yet.
- Deferred (Phase 5 of the plan): in-browser voice recording and Meta `attachment_id` caching.
