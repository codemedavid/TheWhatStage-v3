# TDD Evidence — iPad audio attachments + drag-and-drop upload

**Source plan:** none — journeys derived during this TDD run from the user request
("on iPad I can't attach mp3/any audio — fix it; plus allow drag-and-drop files onto
the attachment area"). The "price" in the original prompt was a voice-transcription
artifact; the user confirmed it meant **files**.

## User journeys

1. As an operator on an iPad, I want to attach an mp3/audio file from the Files app,
   so I can send a voice clip to a lead (today the picker greys them out).
2. As an operator, I want to drag a file from my desktop and drop it onto the
   attachment area to send it, so I don't have to open the file dialog every time.

## Root cause (journey 1)

Two compounding iPadOS/iOS issues in `AttachmentComposer`:

- The file `<input accept="…audio/*…">` lists only the `audio/*` wildcard. iPadOS
  greys out mp3/m4a in the Files picker unless explicit extensions are also listed.
- Files chosen from the iPadOS Files app frequently arrive with an empty/generic
  MIME type, so the old `file.type.startsWith('audio/')` checks failed to recognise
  them — they neither reached the trimmer nor sent as `audio`.

Fix: a pure helper `_lib/attachment-file.ts` exposing `ATTACHMENT_ACCEPT` (wildcards
+ explicit audio extensions), `isAudioFile`, and `attachmentTypeFromFile` (extension
fallback when MIME is missing). The composer now uses these and tags uploads as
`audio` when the server returned a generic type but the file is audio by extension.

## Task report

| Behavior | Validation command | RED → GREEN |
|---|---|---|
| Accept string includes audio extensions + wildcards | `npx vitest run …/attachment-file.test.ts` | RED (module missing) → GREEN |
| Audio detected by MIME and by extension when MIME empty | same | RED → GREEN |
| Type mapping falls back to extension for generic MIME | same | RED → GREEN |
| Dropped non-audio file uploads via operator-upload | `npx vitest run …/AttachmentComposer.test.tsx` | RED (no drop handler) → GREEN |
| Dropped audio (no MIME) routes to the trimmer, no upload | same | RED → GREEN |

RED evidence: both files failed first — `attachment-file` import unresolved; the
component drop did nothing so `fetch` was never called / the trimmer never appeared.
GREEN evidence: `Test Files 2 passed (2) · Tests 10 passed (10)`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `ATTACHMENT_ACCEPT` keeps `audio/*`/`image/*`/`application/pdf` | `attachment-file.test.ts` | unit | PASS |
| 2 | `ATTACHMENT_ACCEPT` lists `.mp3/.m4a/.wav/.aac` for iPadOS | `attachment-file.test.ts` | unit | PASS |
| 3 | `isAudioFile` detects audio by MIME and by extension (no MIME) | `attachment-file.test.ts` | unit | PASS |
| 4 | `isAudioFile` rejects image/video/doc/no-ext | `attachment-file.test.ts` | unit | PASS |
| 5 | `attachmentTypeFromFile` maps by MIME, falls back to extension | `attachment-file.test.ts` | unit | PASS |
| 6 | Dropping a file uploads it to `/api/messenger/operator-upload` | `AttachmentComposer.test.tsx` | component | PASS |
| 7 | Dropping a MIME-less mp3 opens the trimmer, no upload | `AttachmentComposer.test.tsx` | component | PASS |

## Coverage and known gaps

- New pure helper is fully exercised (accept string, both detection functions, all
  branches). Drag-and-drop wiring covered via RTL `fireEvent.drop`.
- Not covered (JSDOM limitation, noted by RTL guidance): real drag visuals/`dragover`
  styling and the actual iPadOS Files picker behaviour — those need a device/E2E run.
- Full leads suite re-run after the change: `Test Files 80 passed · Tests 439 passed`.
