# TDD Evidence: always attach the form when the bot promises one

**Source plan**: conversational `/ecc:plan` run (screenshot bug — bot said "fill up
lang po yung form sa baba" but never sent the action-page button).

## Decisions captured (from clarifying questions)
- Fallback rung order: **button → shortlink → in-chat fill-up template** (shortlink
  is a fallback, NOT the default link format).
- In-chat fill-up template is **per-chatbot** (single config field), not per-action-page.
- "Where to fill up?" force-sends if **a page exists + stage is sendable** (skips the
  qualification gate).

## Scope delivered (Phases 1–3 + Phase 6)
- Phases 1–3: the root-cause tease/force-send fix (commit `9f4f90c`).
- Phase 6: per-chatbot in-chat fill-up fallback (commit `568b4cd`) — when the button
  is policy-blocked, the bot sends `chat_fillup_template` and the customer's reply
  flows into the existing chat-implied submission pipeline.

Deferred (per user choice "in-chat fill-up only"): the shortened deeplink (Phase 5,
new table + `/d/[code]` route) and the explicit `[classify.tease.escaped]` send-site
log + 3-rung ladder (Phase 4). Not implemented.

## User journeys
1. As a lead who said "go na po", when the bot replies "fill up lang po yung form sa
   baba", I receive the actual form button — not a button-less promise.
2. As a lead who asks "Where to fill up?", I receive the form link even if the bot's
   prose didn't tease one.
3. As a lead the bot told "no need to fill up the form / optional lang", I am NOT sent
   a form (negation still suppresses send).

## Task report
| Phase | Summary | RED | GREEN |
|---|---|---|---|
| 1 | Widen `LINK_TEASE_RE` to tolerate ≤5 filler words + "sa baba"/below | 4 failing tease cases | `vitest -t tease` 198 pass |
| 2 | Decouple tease flag from sanitizer delta; preserve `teasedLink` through empty-reply fallback | screenshot integration test → `teasedLinkThisTurn:false` | now `true` |
| 3 | `detectFormRequest` + wire into `decideForceSend` (`override:form-request`) | 15 unit + 2 decision tests failing | all pass |

## Test specification
| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | "fill up lang po yung form sa baba" is a positive tease | `classify.test.ts › hasPositiveLinkTease` | unit | PASS |
| 2 | Particle-laden teases are stripped from the reply | `classify.test.ts › stripLinkTeaseSentences` | unit | PASS |
| 3 | Screenshot phrasing flags `teasedLinkThisTurn` end-to-end | `classify-force-send.test.ts › screenshot bug` | integration | PASS |
| 4 | Tease that empties the reply still attaches the button | preserved `teasedLink` in fallback | integration | PASS |
| 5 | "Where to fill up?" / "saan po mag-fill up" detected | `force-send.test.ts › detectFormRequest` | unit | PASS |
| 6 | Form request force-sends unqualified, bypassing gates | `force-send.test.ts › form-location request` | unit | PASS |
| 7 | Negated form mentions never force-send | `classify.test.ts › hasPositiveLinkTease` (false cases) | unit | PASS |
| 8 | lost/won/dormant + cold-inbound still skip | `force-send.test.ts` guard cases | unit | PASS |

## Validation commands
```
npx vitest run src/lib/chatbot/classify.test.ts src/lib/chatbot/classify-force-send.test.ts src/lib/action-pages/force-send.test.ts
# → Test Files 45 passed (45), Tests 2232 passed (2232)
npx tsc --noEmit   # no errors in touched files
```

## Known gaps / follow-ups
- Phase 6 test gap: the send-site fallback in `process/route.ts` (a large worker
  route) is not unit-tested — the decision is gated on the unit-tested `config`
  mapping + `sendOutbound`. Worth an integration test if the worker grows a harness.
- Phase 6 does not yet tag the resulting submission with `meta.source: 'chat_fillup'`
  — it reuses the existing proceed-intent → `createVirtualSubmission` path as-is. A
  distinct source tag would require tracking that the customer was prompted (stateful).
- Phase 4 (deferred): `[classify.tease.escaped]` log + button→shortlink→in-chat ladder.
- Phase 5 (deferred): `action_page_deeplinks` table + `/d/[code]` route + `shortDeeplinkUrl()`.
