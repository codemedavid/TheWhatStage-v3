import { describe, it, expect, vi } from 'vitest'
import { moveLeadToStage } from './move-stage'

function makeAdmin(rpcResult: unknown = true) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null })
  return { rpc } as unknown as Parameters<typeof moveLeadToStage>[0]
}

describe('moveLeadToStage', () => {
  it('calls set_lead_stage with bot source and forwards matched signals into reason', async () => {
    const admin = makeAdmin(true)
    const ok = await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      confidence: 'medium',
      reason: 'asked price',
      matchedSignals: ['asked price', 'asked schedule'],
      threadId: 't-1',
    })
    expect(ok).toBe(true)
    expect((admin.rpc as ReturnType<typeof vi.fn>).mock.calls[0]).toMatchObject([
      'set_lead_stage',
      expect.objectContaining({
        p_lead_id: 'lead-1',
        p_to_stage_id: 'stage-1',
        p_source: 'bot-deep',
        p_confidence: 'medium',
        p_reason: 'matched: asked price, asked schedule — asked price',
        p_thread_id: 't-1',
      }),
    ])
  })

  it('returns false when the RPC returns false (version mismatch)', async () => {
    const admin = makeAdmin(false)
    const ok = await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      reason: 'r',
      matchedSignals: [],
    })
    expect(ok).toBe(false)
  })

  it('passes reason as-is when matchedSignals is empty', async () => {
    const admin = makeAdmin(true)
    await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      reason: 'manual override',
      matchedSignals: [],
    })
    expect((admin.rpc as ReturnType<typeof vi.fn>).mock.calls[0]).toMatchObject([
      'set_lead_stage',
      expect.objectContaining({ p_reason: 'manual override' }),
    ])
  })

  it('returns false when the RPC returns an error', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'denied' } }),
    } as unknown as Parameters<typeof moveLeadToStage>[0]
    const ok = await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      reason: 'r',
      matchedSignals: [],
    })
    expect(ok).toBe(false)
  })
})
