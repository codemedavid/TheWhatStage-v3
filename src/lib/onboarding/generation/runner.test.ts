import { describe, expect, it, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({
  getJob: vi.fn(),
  upsertRunning: vi.fn(async () => {}),
  enqueueRunning: vi.fn(async () => 'enqueued' as const),
  markDone: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
}))
vi.mock('./repo', () => repo)

const kindsRun = vi.hoisted(() => vi.fn())
vi.mock('./kinds', () => ({ KINDS: { knowledge: { run: kindsRun } } }))

import { runGeneration } from './runner'
import type { KindInput } from './kinds'

const knowledgeInput = {
  basics: { name: 'A' },
  lang: 'tl',
} as unknown as KindInput<'knowledge'>

beforeEach(() => {
  repo.getJob.mockReset()
  repo.upsertRunning.mockReset().mockResolvedValue(undefined)
  repo.enqueueRunning.mockReset().mockResolvedValue('enqueued' as never)
  repo.markDone.mockReset().mockResolvedValue(undefined)
  repo.markFailed.mockReset().mockResolvedValue(undefined)
  kindsRun.mockReset()
})

describe('runGeneration', () => {
  it('writes running -> done on success', async () => {
    repo.enqueueRunning.mockResolvedValue('enqueued' as never)
    kindsRun.mockResolvedValue({ sections: [{ title: 't', body: 'b' }] })
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(repo.enqueueRunning).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String))
    expect(repo.markDone).toHaveBeenCalledWith(
      'p1',
      'knowledge',
      expect.any(String),
      { sections: [{ title: 't', body: 'b' }] },
    )
  })

  it('writes running -> failed when the generator throws', async () => {
    repo.enqueueRunning.mockResolvedValue('enqueued' as never)
    kindsRun.mockRejectedValue(new Error('boom'))
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(repo.markFailed).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String), 'boom')
    expect(repo.markDone).not.toHaveBeenCalled()
  })

  it('never throws even when repo fails', async () => {
    repo.enqueueRunning.mockRejectedValue(new Error('db down'))
    kindsRun.mockResolvedValue({})
    await expect(
      runGeneration('p1', 'knowledge', knowledgeInput),
    ).resolves.toBeUndefined()
  })

  it('short-circuits when enqueue reports already_done', async () => {
    repo.enqueueRunning.mockResolvedValue('already_done' as never)
    kindsRun.mockResolvedValue({ ok: true })
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(kindsRun).not.toHaveBeenCalled()
    expect(repo.markDone).not.toHaveBeenCalled()
  })

  it('short-circuits when enqueue reports in_progress', async () => {
    repo.enqueueRunning.mockResolvedValue('in_progress' as never)
    kindsRun.mockResolvedValue({ ok: true })
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(kindsRun).not.toHaveBeenCalled()
  })
})
