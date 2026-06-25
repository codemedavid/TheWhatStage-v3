# TDD Evidence — Operator audio upload "too long" fix

**Date:** 2026-06-26
**Branch:** `perf/classify-salvage-reply`
**Commit:** `a9e7600` — fix(messenger): upload operator audio direct to ImageKit, not via the 4.5MB function cap

## Source plan

No `*.plan.md` was used. Journeys were derived during this TDD run from the bug
report: "Always saying audio too long even when sending just 40s, under 25 MB."

## Root cause

The "audio too long / that clip is too large to send, trim to a shorter
selection" message was **not** Meta's and **not** our 25 MB limit. It was a
`413 Request Entity Too Large` from the **Vercel serverless function body cap
(~4.5 MB)** that every upload passed through (`POST /api/messenger/operator-upload`).

Two things tripped it well under 25 MB:

1. The upload route runs as a Vercel function; the platform rejects request
   bodies over ~4.5 MB before our own `MAX_BYTES = 25 MB` check runs.
2. The trimmer re-encodes clips to **uncompressed 16-bit PCM WAV**
   (`audio-trim.ts`). A 40 s mono clip @48 kHz ≈ 3.84 MB; a stereo/high-rate or
   ~45–50 s clip sails past 4.5 MB. A tiny 40 s MP3 (~0.6 MB) becomes a ~4 MB WAV.

Meta imposes only a file-size limit on audio attachments, not a duration limit
(<https://developers.facebook.com/docs/messenger-platform/reference/send-api/>).

## Fix

Upload bytes **directly from the browser to ImageKit** using a short-lived,
operator-scoped signature minted server-side, so the file never transits the
Vercel function. The real limit becomes our own 25 MB client validation.

- `src/app/(app)/dashboard/leads/_lib/operator-upload-client.ts` — `validateOperatorFile` + `uploadOperatorAttachment`
- `src/app/api/messenger/imagekit-auth/route.ts` — authenticated `GET` returning `{ token, expire, signature, publicKey, folder }`
- `src/app/(app)/dashboard/leads/_components/AttachmentComposer.tsx` — uses the new helper
- Removed dead `src/app/api/messenger/operator-upload/route.ts`

## User journeys

1. As an operator, I want to send a ~40 s voice clip (under 25 MB) without a
   bogus "too long / too large" rejection.
2. As an operator on iPadOS (file picks with empty MIME), I want audio still
   classified as audio.
3. As an operator, I want oversized (>25 MB) or unsupported files rejected with
   a clear message before any upload is attempted.
4. As an operator, I want a clear error if upload auth or ImageKit itself fails.

## Task report

| Step | Summary | Command | Result |
|------|---------|---------|--------|
| RED  | New test imports a non-existent module | `npx vitest run …/operator-upload-client.test.ts` | FAIL — "Failed to resolve import './operator-upload-client'" (compile-time RED) |
| GREEN | Implement validator + direct-upload helper | `npx vitest run …/operator-upload-client.test.ts` | PASS — 10/10 |
| Integrate | Wire composer to direct upload; update its test to the new 2-call flow | `npx vitest run …/AttachmentComposer.test.tsx` | PASS |
| Regression | Full leads suite | `npx vitest run "src/app/(app)/dashboard/leads/"` | PASS — 81 files, 449 tests |
| Types | Project typecheck | `npx tsc --noEmit` | 0 source errors (2 stale `.next/` validator refs to the deleted route; `.next` is gitignored and regenerates on build) |
| Lint | Changed files | `npx eslint <changed files>` | 0 errors, 0 warnings |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Empty file rejected before upload | `operator-upload-client.test.ts › rejects an empty file` | unit | PASS |
| 2 | >25 MB rejected before upload | `… › rejects a file over the 25 MB limit` | unit | PASS |
| 3 | ~4 MB / 40 s clip accepted (would 413 via the function) | `… › accepts a 40-second-sized voice clip well under the limit` | unit | PASS |
| 4 | Empty-MIME audio classified by extension (iPadOS) | `… › classifies audio with an empty MIME via its extension` | unit | PASS |
| 5 | PDF accepted as `file`; other unknowns rejected | `… › accepts a PDF` / `… › rejects an unsupported type` | unit | PASS |
| 6 | Validation error short-circuits with no network call | `… › returns a validation error without hitting the network` | unit | PASS |
| 7 | Auth then direct ImageKit upload; bytes never hit our API | `… › fetches signed auth then uploads bytes straight to ImageKit` | unit | PASS |
| 8 | ImageKit error message surfaced | `… › surfaces an ImageKit error message` | unit | PASS |
| 9 | Auth failure → clear error, no upload | `… › returns a clear error when auth fails` | unit | PASS |
| 10 | Composer drives the 2-call direct-upload flow | `AttachmentComposer.test.tsx › uploads a file dropped onto the upload area straight to ImageKit` | component | PASS |

## Coverage and known gaps

- The pure validator and the upload helper are unit-covered (success + every
  error branch). The new `imagekit-auth` route is a thin auth+signature wrapper
  with no branching beyond the existing `requireUser` pattern; not separately
  unit-tested (consistent with sibling upload routes).
- Live end-to-end send to Meta was not exercised in this run (no test FB page in
  the harness). Recommend a manual send of a ~60–90 s clip to confirm the cap is
  gone in production.

## Merge evidence

RED: missing-module import error on first run. GREEN: 10/10 new unit tests +
449/449 leads regression. Types/lint clean. Single commit `a9e7600`.
