// Pure, DB-free assembler for a proactive follow-up draft prompt. Kept separate
// from shared.ts (which does I/O) so it stays trivially unit-testable.
//
// Why this exists: follow-up touches previously used ONLY the bare chatbot
// persona — they ignored the operator's free-form instructions, Do/Don't rules,
// and the knowledge base that the live chatbot honours, so follow-ups drifted
// off-brand and off-policy. Worse, because each touch wasn't grounded in the
// specific project's own AI instructions, operators hardcoded one customer's
// details into the stage-wide step text, which then leaked into EVERY lead's
// follow-up. This assembler injects the full chatbot brain and anchors every
// touch to THIS customer's project facts + this thread's conversation, with an
// explicit guard against referencing any other customer/project.

export type DraftChatMessage = { role: 'user' | 'assistant'; content: string }

/** The brand/policy/customer context shared by the single-step and batch
 *  prompt builders. Everything here describes WHO is writing and to WHOM —
 *  not the per-touch goal(s), which differ between the two builders. */
export interface DraftBrainArgs {
  /** Optional time/context preamble (e.g. manilaNowBlock()). Empty in tests. */
  nowBlock?: string
  leadName: string | null
  /** Brand voice. */
  persona: string | null
  /** Operator's free-form chatbot instructions. */
  instructions: string | null
  doRules: string[]
  dontRules: string[]
  /** Pre-rendered knowledge-base context block ('' / null when none). */
  knowledge: string | null
  /** The project title this touch is about (the card the run belongs to). */
  contextTitle: string | null
  /** THIS project's authoritative customer facts ('' / null when none). */
  aiInstructions: string | null
  /** Per-STAGE guidance: how to communicate / follow up while in this stage.
   *  Stage-wide (applies to every card in the stage), never customer-specific. */
  stageInstructions?: string | null
  /** Per-stage Do rules, layered ON TOP of the global chatbot Do rules. */
  stageDoRules?: string[]
  /** Per-stage Don't rules, layered ON TOP of the global chatbot Don't rules. */
  stageDontRules?: string[]
}

export interface FollowupDraftPromptArgs extends DraftBrainArgs {
  /** The stage-wide GENERIC goal for this touch (not customer-specific). */
  stepInstruction: string
  recentMessages: DraftChatMessage[]
}

/** One step in a batch (whole-sequence) draft request. */
export interface BatchStep {
  position: number
  delayMinutes: number
  instruction: string
}

export interface SequenceBatchPromptArgs extends DraftBrainArgs {
  steps: BatchStep[]
  recentMessages: DraftChatMessage[]
}

export interface DraftPrompt {
  system: string
  user: string
}

function bulletList(items: string[]): string {
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n')
}

// Assemble the shared "brain" sections (persona + instructions + global/stage
// rules + per-project facts + knowledge) common to both the single-step and the
// batch prompt. Sections are only emitted when their data is present, so a
// sparse config never produces "undefined"/"null" text. Returns the resolved
// addressee (`who`) so callers can reuse it in the grounding guard.
function buildBrainSections(args: DraftBrainArgs): { sections: string[]; who: string } {
  const {
    nowBlock,
    leadName,
    persona,
    instructions,
    doRules,
    dontRules,
    knowledge,
    contextTitle,
    aiInstructions,
    stageInstructions,
    stageDoRules,
    stageDontRules,
  } = args

  const who = leadName?.trim() || 'this customer'
  const sections: string[] = []

  if (nowBlock?.trim()) sections.push(nowBlock.trim())
  if (persona?.trim()) sections.push(persona.trim())

  if (instructions?.trim()) {
    sections.push(`# How you work\n${instructions.trim()}`)
  }

  const dos = bulletList(doRules ?? [])
  const donts = bulletList(dontRules ?? [])
  if (dos || donts) {
    const rules: string[] = ['# Rules (follow strictly)']
    if (dos) rules.push(`Do:\n${dos}`)
    if (donts) rules.push(`Don't:\n${donts}`)
    sections.push(rules.join('\n'))
  }

  // Per-stage guidance + rules: how to communicate WHILE the card sits in this
  // stage. Stage-wide (every card in the stage), layered above the per-project
  // facts but below the global brand rules.
  const stageGuide = stageInstructions?.trim()
  const stageDos = bulletList(stageDoRules ?? [])
  const stageDonts = bulletList(stageDontRules ?? [])
  if (stageGuide || stageDos || stageDonts) {
    const stage: string[] = ['# How to follow up at this stage']
    if (stageGuide) stage.push(stageGuide)
    if (stageDos) stage.push(`Do:\n${stageDos}`)
    if (stageDonts) stage.push(`Don't:\n${stageDonts}`)
    sections.push(stage.join('\n'))
  }

  // The per-project AI instructions are the AUTHORITATIVE customer facts. When
  // absent we only name the project generically — never fabricate facts.
  const facts = aiInstructions?.trim()
  if (facts) {
    const title = contextTitle?.trim()
    sections.push(
      `# About ${who}${title ? ` — project "${title}"` : ''} (authoritative facts, follow strictly)\n${facts}`,
    )
  } else if (contextTitle?.trim()) {
    sections.push(`This follow-up is about the project "${contextTitle.trim()}".`)
  }

  if (knowledge?.trim()) {
    sections.push(
      `# Business knowledge (use ONLY these facts; never invent prices or products)\n${knowledge.trim()}`,
    )
  }

  return { sections, who }
}

// Render the recent-conversation preamble shared by both builders ('' when no
// history), so the user message never starts with a stray "Recent conversation:".
function renderConversation(recentMessages: DraftChatMessage[]): string {
  if (recentMessages.length === 0) return ''
  return `Recent conversation:\n${recentMessages
    .map((m) => `${m.role === 'assistant' ? 'You' : 'Them'}: ${m.content}`)
    .join('\n')}\n\n`
}

// Build the {system, user} pair for a proactive follow-up draft. Sections are
// only emitted when their data is present, so a sparse config never produces
// "undefined"/"null" text.
export function buildFollowupDraftPrompt(args: FollowupDraftPromptArgs): DraftPrompt {
  const { sections, who } = buildBrainSections(args)

  sections.push(
    [
      `You are writing a SHORT, proactive Messenger follow-up to ${who}.`,
      `GROUNDING RULES (critical):`,
      `- Write ONLY about ${who}, using the authoritative facts above and the conversation below.`,
      `- This message is for THIS customer in THIS conversation only. Never mention other customers, other projects, or any name that is not part of this conversation.`,
      `- Do not invent prices, products, promises, or facts that are not in the facts/knowledge above.`,
      `- Keep it under 3 sentences. Sound human, match the customer's language, and don't overuse emojis.`,
      `Output ONLY the message text — no quotes, no preamble, no explanation.`,
    ].join('\n'),
  )

  const system = sections.join('\n\n')
  const user = `${renderConversation(args.recentMessages)}Goal of this follow-up: ${args.stepInstruction.trim()}`

  return { system, user }
}

// Build the {system, user} pair for drafting the WHOLE sequence in one LLM call
// (one message per step). Reuses the exact same brain + grounding guard as the
// single-step prompt; the difference is the model must return a JSON array so
// every touch is generated and stored at once (saves N-1 LLM calls per lead).
export function buildSequenceBatchPrompt(args: SequenceBatchPromptArgs): DraftPrompt {
  const { sections, who } = buildBrainSections(args)
  const count = args.steps.length

  sections.push(
    [
      `You are writing ${count} SHORT, proactive Messenger follow-up message(s) to ${who} — one per step listed below.`,
      `GROUNDING RULES (critical):`,
      `- Write ONLY about ${who}, using the authoritative facts above and the conversation below.`,
      `- Each message is for THIS customer in THIS conversation only. Never mention other customers, other projects, or any name that is not part of this conversation.`,
      `- Do not invent prices, products, promises, or facts that are not in the facts/knowledge above.`,
      `- Keep each message under 3 sentences. Sound human, match the customer's language, and don't overuse emojis.`,
      `- The messages are sent on a schedule over time, in order, each only if the customer has not yet replied. Make later touches escalate gently without repeating earlier wording.`,
      `OUTPUT FORMAT (strict):`,
      `- Return ONLY a JSON array of exactly ${count} object(s), in step order: [{"step": <number>, "message": "<text>"}, ...].`,
      `- "step" is the step number shown below. "message" is the message text only — no quotes, no preamble, no explanation.`,
      `- Output the raw JSON array and nothing else (no markdown fences).`,
    ].join('\n'),
  )

  const system = sections.join('\n\n')

  const stepLines = args.steps
    .map((s) => `Step ${s.position} (sent after ${humanizeMinutes(s.delayMinutes)}): ${s.instruction.trim()}`)
    .join('\n')
  const user = `${renderConversation(args.recentMessages)}Write a follow-up message for each of these ${count} step(s):\n${stepLines}`

  return { system, user }
}

// Compact human label for a delay, used to give the model timing context in the
// batch prompt (so a "3 days later" touch reads differently than a "5 min" one).
function humanizeMinutes(minutes: number): string {
  if (minutes <= 0) return 'no delay'
  if (minutes < 60) return `${minutes} minute(s)`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hour(s)`
  return `${Math.round(minutes / 1440)} day(s)`
}
