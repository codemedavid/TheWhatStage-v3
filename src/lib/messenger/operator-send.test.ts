import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminStub }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (v: string) => `dec:${v}` }))
vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: vi.fn() }))

import { sendOutbound } from '@/lib/messenger/outbound'
import { replyAsOperatorFor } from './operator-send'

const adminStub = { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }

type Recorded = { table: string; op: string; values?: unknown }

function makeSupabase(thread: Record<string, unknown> | null, takeoverMinutes = 30) {
  const recorded: Recorded[] = []
  const supabase = {
    from(table: string) {
      const rec: Recorded = { table, op: 'select' }
      recorded.push(rec)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.insert = (values: unknown) => { rec.op = 'insert'; rec.values = values; return Promise.resolve({ error: null }) }
      chain.update = (values: unknown) => { rec.op = 'update'; rec.values = values; return chain }
      chain.maybeSingle = async () => {
        if (table === 'messenger_threads') return { data: thread, error: null }
        if (table === 'chatbot_configs') return { data: { human_takeover_minutes: takeoverMinutes }, error: null }
        return { data: null, error: null }
      }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
      return chain
    },
  }
  return { supabase: supabase as never, recorded }
}

const THREAD = {
  id: 't1', psid: 'psid1', page_id: 'p1', last_inbound_at: null, controlled_by_run_id: null,
  facebook_pages: { page_access_token: 'enc' },
}

beforeEach(() => vi.mocked(sendOutbound).mockReset())

describe('replyAsOperatorFor', () => {
  it('sends via the operator policy, records the audit row, and pauses the bot', async () => {
    vi.mocked(sendOutbound).mockResolvedValue({ sent: true, messageId: 'mid' })
    const { supabase, recorded } = makeSupabase(THREAD)

    const out = await replyAsOperatorFor(supabase, 'u1', 'lead1', '  hello  ')

    expect(out).toEqual({ ok: true })
    expect(sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'operator', pageToken: 'dec:enc', payload: { kind: 'text', text: 'hello' },
    }))
    const audit = recorded.find((r) => r.table === 'messenger_messages')
    expect(audit?.values).toMatchObject({ user_id: 'u1', sender: 'operator', fb_message_id: 'mid', body: 'hello', error: null })
    const pause = recorded.find((r) => r.table === 'messenger_threads' && r.op === 'update' && (r.values as { bot_paused_until?: string }).bot_paused_until)
    expect(pause).toBeDefined()
  })

  it('returns a policy block verbatim and still records it', async () => {
    vi.mocked(sendOutbound).mockResolvedValue({ sent: false, reason: 'window' })
    const { supabase, recorded } = makeSupabase(THREAD)

    const out = await replyAsOperatorFor(supabase, 'u1', 'lead1', 'hi')

    expect(out).toEqual({ ok: false, error: 'policy_blocked:window' })
    const audit = recorded.find((r) => r.table === 'messenger_messages')
    expect(audit?.values).toMatchObject({ error: 'policy_blocked:window', fb_message_id: null })
  })

  it('throws when the lead has no thread and skips empty text', async () => {
    const { supabase } = makeSupabase(null)
    await expect(replyAsOperatorFor(supabase, 'u1', 'lead1', 'hi')).rejects.toThrow('no Messenger thread')
    expect(await replyAsOperatorFor(supabase, 'u1', 'lead1', '   ')).toEqual({ ok: true })
    expect(sendOutbound).not.toHaveBeenCalled()
  })
})
