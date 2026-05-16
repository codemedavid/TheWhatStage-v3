import { describe, expect, it, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({
  getJob: vi.fn(),
  upsertRunning: vi.fn(async () => {}),
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
  repo.markDone.mockReset().mockResolvedValue(undefined)
  repo.markFailed.mockReset().mockResolvedValue(undefined)
  kindsRun.mockReset()
})

describe('runGeneration', () => {
  it('writes running -> done on success', async () => {
    repo.getJob.mockResolvedValue(null)
    kindsRun.mockResolvedValue({ sections: [{ title: 't', body: 'b' }] })
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(repo.upsertRunning).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String))
    expect(repo.markDone).toHaveBeenCalledWith(
      'p1',
      'knowledge',
      expect.any(String),
      { sections: [{ title: 't', body: 'b' }] },
    )
  })

  it('writes running -> failed when the generator throws', async () => {
    repo.getJob.mockResolvedValue(null)
    kindsRun.mockRejectedValue(new Error('boom'))
    await runGeneration('p1', 'knowledge', knowledgeInput)
    expect(repo.markFailed).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String), 'boom')
    expect(repo.markDone).not.toHaveBeenCalled()
  })

  it('never throws even when repo fails', async () => {
    repo.getJob.mockRejectedValue(new Error('db down'))
    kindsRun.mockResolvedValue({})
    await expect(
      runGeneration('p1', 'knowledge', knowledgeInput),
    ).resolves.toBeUndefined()
  })

  it('short-circuits when the same input was previously generated', async () => {
    let lastHash = ''
    repo.upsertRunning.mockImplementation((async (_p: string, _k: string, h: string) => {
      lastHash = h
    }) as never)
    repo.getJob
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => ({ status: 'done', input_hash: lastHash }))
    kindsRun.mockResolvedValue({ ok: true })
    const input = knowledgeInput
    await runGeneration('p1', 'knowledge', input)
    await runGeneration('p1', 'knowledge', input)
    expect(kindsRun).toHaveBeenCalledTimes(1)
  })
})
