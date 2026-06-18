// Exercises the project-sequence job handler: load run → project → steps →
// draft (with fallback on empty/error) → send → advance, and the messenger_jobs
// status mapping. The shared draft/load/send layer is mocked so the test
// focuses on fire.ts's own fallback + outcome logic.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { draftMock, loadMock, sendMock, advanceMock } = vi.hoisted(() => ({
  draftMock: vi.fn(),
  loadMock: vi.fn(),
  sendMock: vi.fn(),
  advanceMock: vi.fn(),
}))

vi.mock('@/lib/sequences/shared', () => ({
  draftSequenceStep: draftMock,
  loadSequenceSendContext: loadMock,
  sendAndRecordStep: sendMock,
  nextSequenceState: advanceMock,
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { handleProjectSequenceSendJob } from './fire'

type Step = { position: number; delay_minutes: number; instruction: string; fallback_message: string | null }

function makeAdmin(seed: {
  run: Record<string, unknown> | null
  project: Record<string, unknown> | null
  steps: Step[]
}) {
  const runUpdates: Array<Record<string, unknown>> = []
  const jobUpdates: Array<Record<string, unknown>> = []

  const admin = {
    from(table: string) {
      const ctx = { table, op: 'select' as 'select' | 'update' | 'insert' | 'delete', payload: null as unknown }
      const record = () => {
        if (ctx.op !== 'update') return
        if (table === 'project_sequence_runs') runUpdates.push(ctx.payload as Record<string, unknown>)
        if (table === 'messenger_jobs') jobUpdates.push(ctx.payload as Record<string, unknown>)
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (v: unknown) => { ctx.op = 'update'; ctx.payload = v; return chain },
        insert: (v: unknown) => { ctx.op = 'insert'; ctx.payload = v; return chain },
        delete: () => { ctx.op = 'delete'; return chain },
        in: () => chain,
        limit: () => chain,
        eq: () => { record(); return chain },
        order: () => {
          if (table === 'project_stage_sequence_steps' && ctx.op === 'select') {
            return Promise.resolve({ data: seed.steps, error: null })
          }
          return chain
        },
        maybeSingle: async () => {
          if (table === 'project_sequence_runs') return { data: seed.run, error: null }
          if (table === 'projects') return { data: seed.project, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
  return { admin: admin as never, runUpdates, jobUpdates }
}

const baseRun = {
  id: 'run-1', user_id: 'u1', project_id: 'p1', sequence_id: 'seq-1', stage_id: 'st-1',
  lead_id: 'l1', thread_id: 't1', started_at: '2026-06-18T00:00:00.000Z', next_step_idx: 0, status: 'running',
}
const baseProject = { id: 'p1', stage_id: 'st-1', title: 'Roof repair', ai_instructions: 'Quoted 50k, ask if they decided.' }

beforeEach(() => {
  vi.clearAllMocks()
  loadMock.mockResolvedValue({ ok: true, ctx: { thread: { id: 't1', psid: 'x', last_inbound_at: null, full_name: null, page_id: 'pg' }, pageToken: 'tok', persona: null, leadName: 'Ana', recentMessages: [] } })
  sendMock.mockResolvedValue({ sent: true, messageId: 'm1' })
  advanceMock.mockReturnValue({ done: true })
})

describe('handleProjectSequenceRun fallback behaviour', () => {
  it('sends the step fallback_message when the draft is empty (does not fail the run)', async () => {
    draftMock.mockResolvedValue('')
    const { admin, runUpdates, jobUpdates } = makeAdmin({
      run: baseRun, project: baseProject,
      steps: [{ position: 0, delay_minutes: 5, instruction: 'Ask if they decided', fallback_message: 'Hi Ana, have you decided on the roof repair?' }],
    })

    await handleProjectSequenceSendJob(admin, { id: 'job-1', payload: { run_id: 'run-1' } })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][1].text).toBe('Hi Ana, have you decided on the roof repair?')
    // run advanced to done (not failed), job marked done
    expect(runUpdates.some((u) => u.status === 'failed')).toBe(false)
    expect(jobUpdates.at(-1)?.status).toBe('done')
  })

  it('uses the step fallback when the draft throws', async () => {
    draftMock.mockRejectedValue(new Error('llm 500'))
    const { admin, jobUpdates } = makeAdmin({
      run: baseRun, project: baseProject,
      steps: [{ position: 0, delay_minutes: 5, instruction: 'Ask', fallback_message: 'Following up on your project.' }],
    })

    await handleProjectSequenceSendJob(admin, { id: 'job-2', payload: { run_id: 'run-1' } })

    expect(sendMock.mock.calls[0][1].text).toBe('Following up on your project.')
    expect(jobUpdates.at(-1)?.status).toBe('done')
  })

  it('falls back to the built-in default when draft is empty and no fallback_message is set', async () => {
    draftMock.mockResolvedValue('')
    const { admin } = makeAdmin({
      run: baseRun, project: baseProject,
      steps: [{ position: 0, delay_minutes: 5, instruction: 'Ask', fallback_message: null }],
    })

    await handleProjectSequenceSendJob(admin, { id: 'job-3', payload: { run_id: 'run-1' } })

    expect(sendMock.mock.calls[0][1].text).toMatch(/^Hi! Just following up/)
  })

  it('marks the run AND job failed when the send is blocked (no masking)', async () => {
    draftMock.mockResolvedValue('Real drafted line')
    sendMock.mockResolvedValue({ sent: false, reason: 'opted_out' })
    const { admin, runUpdates, jobUpdates } = makeAdmin({
      run: baseRun, project: baseProject,
      steps: [{ position: 0, delay_minutes: 5, instruction: 'Ask', fallback_message: 'fb' }],
    })

    await handleProjectSequenceSendJob(admin, { id: 'job-4', payload: { run_id: 'run-1' } })

    expect(runUpdates.some((u) => u.status === 'failed')).toBe(true)
    expect(jobUpdates.at(-1)?.status).toBe('failed')
  })
})
