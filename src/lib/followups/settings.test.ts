import { describe, expect, it, vi } from 'vitest'
import {
  FOLLOWUP_SETTINGS_SCHEMA,
  DEFAULT_FOLLOWUP_SETTINGS,
  resolveEnabledOffsets,
  loadFollowupSettings,
  type FollowupSettings,
} from './settings'

function validSettings(overrides: Partial<FollowupSettings> = {}): FollowupSettings {
  return {
    enabled: true,
    ai_enabled: false,
    touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
      ...t,
      image_media_asset_ids: [],
      action_page_id: null,
    })),
    ...overrides,
  }
}

describe('FOLLOWUP_SETTINGS_SCHEMA', () => {
  it('accepts the defaults', () => {
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(DEFAULT_FOLLOWUP_SETTINGS).success).toBe(true)
  })

  it('rejects touchpoints.length !== 7', () => {
    const bad = { ...DEFAULT_FOLLOWUP_SETTINGS, touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.slice(0, 6) }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects offset_ms below 1 minute', () => {
    const bad = validSettings()
    bad.touchpoints[0] = { enabled: true, offset_ms: 30_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // 30s
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects offset_ms above 7 days', () => {
    const bad = validSettings()
    bad.touchpoints[6] = { enabled: true, offset_ms: 8 * 24 * 3_600_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // 8 days
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects non-strictly-increasing enabled rows', () => {
    const bad = validSettings()
    bad.touchpoints[1] = { enabled: true, offset_ms: 60_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // 1m, less than slot 0's 5m
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('ignores ordering of disabled rows', () => {
    const ok = validSettings()
    ok.touchpoints[1] = { enabled: false, offset_ms: 60_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // disabled, ignore
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('rejects master enabled with zero enabled rows', () => {
    const bad = validSettings()
    bad.touchpoints = bad.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('allows master disabled with any (or zero) enabled rows', () => {
    const ok = validSettings({ enabled: false })
    ok.touchpoints = ok.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('defaults instruction to "" when missing on a touchpoint', () => {
    const noInstr = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
      })),
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(noInstr)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      for (const tp of parsed.data.touchpoints) {
        expect(tp.instruction).toBe('')
      }
    }
  })

  it('rejects instruction longer than 200 chars', () => {
    const bad = validSettings()
    bad.touchpoints[0] = { ...bad.touchpoints[0], instruction: 'x'.repeat(201) }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('trims surrounding whitespace from instruction', () => {
    const ok = validSettings()
    ok.touchpoints[0] = { ...ok.touchpoints[0], instruction: '  hello  ' }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.touchpoints[0].instruction).toBe('hello')
  })

  it('accepts touchpoints with image_media_asset_ids and action_page_id set', () => {
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: ['11111111-1111-4111-9111-111111111111'],
      action_page_id:        '22222222-2222-4222-9222-222222222222',
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('defaults missing attachment fields to empty/null', () => {
    const minimal = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
      })),
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(minimal)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.touchpoints[0].image_media_asset_ids).toEqual([])
      expect(parsed.data.touchpoints[0].action_page_id).toBeNull()
    }
  })

  it('rejects non-UUID inside image_media_asset_ids array', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: ['not-a-uuid'],
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects non-UUID action_page_id', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: [],
      action_page_id: 'nope',
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects more than 3 images on a touchpoint', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
        '44444444-4444-4444-9444-444444444444',
      ],
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('accepts exactly 3 images on a touchpoint', () => {
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('defaults ai_enabled to false when missing', () => {
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse({
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.ai_enabled).toBe(false)
  })

  it('accepts ai_enabled set to true', () => {
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(validSettings({ ai_enabled: true }))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.ai_enabled).toBe(true)
  })

  it('rejects a manual message longer than 200 chars', () => {
    const bad = validSettings()
    bad.touchpoints[0] = { ...bad.touchpoints[0], message: 'x'.repeat(201) }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('trims surrounding whitespace from a manual message', () => {
    const ok = validSettings()
    ok.touchpoints[0] = { ...ok.touchpoints[0], message: '  Hi {name}  ' }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.touchpoints[0].message).toBe('Hi {name}')
  })

  it('preserves image_media_asset_ids order through parse', () => {
    const ids = [
      '11111111-1111-4111-9111-111111111111',
      '22222222-2222-4222-9222-222222222222',
    ]
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: ids,
      action_page_id: null,
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.touchpoints[0].image_media_asset_ids).toEqual(ids)
  })
})

describe('DEFAULT_FOLLOWUP_SETTINGS — manual mode defaults', () => {
  it('ships with AI disabled by default', () => {
    expect(DEFAULT_FOLLOWUP_SETTINGS.ai_enabled).toBe(false)
  })

  it('ships a non-empty manual message for every touchpoint', () => {
    for (const t of DEFAULT_FOLLOWUP_SETTINGS.touchpoints) {
      expect(typeof t.message).toBe('string')
      expect((t.message ?? '').trim().length).toBeGreaterThan(0)
    }
  })
})

describe('resolveEnabledOffsets', () => {
  it('returns 7-entry snapshot with slots 0..6 on defaults', () => {
    const snap = resolveEnabledOffsets(DEFAULT_FOLLOWUP_SETTINGS)
    expect(snap).toHaveLength(7)
    expect(snap.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(snap[0].offset_ms).toBe(300_000)
    expect(snap[6].offset_ms).toBe(86_400_000)
    expect(snap[0].instruction).toMatch(/Quick light hello/i)
  })

  it('carries the manual message and ai_enabled=false into each snapshot entry', () => {
    const s = validSettings({ ai_enabled: false })
    s.touchpoints[0] = { ...s.touchpoints[0], message: 'Hi {name}, manual one po' }
    const snap = resolveEnabledOffsets(s)
    const slot0 = snap.find((e) => e.slot === 0)
    expect(slot0?.message).toBe('Hi {name}, manual one po')
    expect(snap.every((e) => e.ai_enabled === false)).toBe(true)
  })

  it('stamps ai_enabled=true on every entry when AI is on', () => {
    const snap = resolveEnabledOffsets(validSettings({ ai_enabled: true }))
    expect(snap.length).toBeGreaterThan(0)
    expect(snap.every((e) => e.ai_enabled === true)).toBe(true)
  })

  it('skips disabled rows and preserves original slot indices', () => {
    const settings = validSettings()
    settings.touchpoints[1].enabled = false // slot 1 (1h) off
    settings.touchpoints[3].enabled = false // slot 3 (8h) off
    settings.touchpoints[5].enabled = false // slot 5 (18h) off
    const snap = resolveEnabledOffsets(settings)
    expect(snap.map((s) => s.slot)).toEqual([0, 2, 4, 6])
  })

  it('returns [] when master toggle is off', () => {
    expect(resolveEnabledOffsets(validSettings({ enabled: false }))).toEqual([])
  })

  it('returns [] when master is on but every row disabled (defensive)', () => {
    const s = validSettings()
    s.touchpoints = s.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(resolveEnabledOffsets(s)).toEqual([])
  })

  it('sorts ascending by offset_ms even if user reordered', () => {
    const s = validSettings()
    s.touchpoints[5] = { enabled: true, offset_ms: 86_400_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // 24h in slot 5
    s.touchpoints[6] = { enabled: true, offset_ms: 64_800_000, instruction: '', image_media_asset_ids: [], action_page_id: null } // 18h in slot 6
    const snap = resolveEnabledOffsets(s)
    // resolver sorts by offset_ms ascending so 18h (slot 6) comes before 24h (slot 5)
    expect(snap.map((e) => e.offset_ms)).toEqual([
      300_000, 3_600_000, 18_000_000, 28_800_000, 43_200_000, 64_800_000, 86_400_000,
    ])
    expect(snap[5].slot).toBe(6)  // 18h entry came from slot 6
    expect(snap[6].slot).toBe(5)  // 24h entry came from slot 5
  })

  it('propagates instruction from touchpoint to snapshot entry', () => {
    const s = validSettings()
    s.touchpoints[0] = { ...s.touchpoints[0], instruction: 'quick hello' }
    s.touchpoints[2] = { ...s.touchpoints[2], instruction: 'share a benefit' }
    const snap = resolveEnabledOffsets(s)
    const slot0 = snap.find((e) => e.slot === 0)
    const slot2 = snap.find((e) => e.slot === 2)
    expect(slot0?.instruction).toBe('quick hello')
    expect(slot2?.instruction).toBe('share a benefit')
  })

  it('snapshot entries default instruction to "" when unset', () => {
    const snap = resolveEnabledOffsets(DEFAULT_FOLLOWUP_SETTINGS)
    for (const e of snap) {
      expect(e.instruction).toBe(DEFAULT_FOLLOWUP_SETTINGS.touchpoints[e.slot].instruction)
    }
  })
})

describe('loadFollowupSettings', () => {
  function makeAdmin(result: { data: unknown; error: unknown }) {
    return {
      from() {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = async () => result
        return chain
      },
    } as never
  }

  it('returns defaults when row missing', async () => {
    const admin = makeAdmin({ data: null, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
  })

  it('returns defaults when followup_settings column is null', async () => {
    const admin = makeAdmin({ data: { followup_settings: null }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
  })

  it('returns defaults and logs once when stored value fails to parse', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const admin = makeAdmin({ data: { followup_settings: { enabled: 'yes' } }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns defaults and logs once on DB error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const admin = makeAdmin({ data: null, error: { message: 'boom' } })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns parsed settings when stored value is valid', async () => {
    const stored = { enabled: false, ai_enabled: false, touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints }
    const admin = makeAdmin({ data: { followup_settings: stored }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(stored)
  })

  it('upgrades legacy stored shape (image_media_asset_id) to image_media_asset_ids', async () => {
    const legacy = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
        // Legacy singular field, no array
        image_media_asset_id: i === 0 ? '11111111-1111-4111-9111-111111111111' : null,
        action_page_id: null,
      })),
    }
    const admin = makeAdmin({ data: { followup_settings: legacy }, error: null })
    const parsed = await loadFollowupSettings(admin, 'u1')
    expect(parsed.touchpoints[0].image_media_asset_ids).toEqual([
      '11111111-1111-4111-9111-111111111111',
    ])
    expect(parsed.touchpoints[1].image_media_asset_ids).toEqual([])
  })

  it('passes through new shape (image_media_asset_ids) unchanged', async () => {
    const fresh = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
        image_media_asset_ids: i === 0 ? ['11111111-1111-4111-9111-111111111111'] : [],
        action_page_id: null,
      })),
    }
    const admin = makeAdmin({ data: { followup_settings: fresh }, error: null })
    const parsed = await loadFollowupSettings(admin, 'u1')
    expect(parsed.touchpoints[0].image_media_asset_ids).toEqual([
      '11111111-1111-4111-9111-111111111111',
    ])
  })
})
