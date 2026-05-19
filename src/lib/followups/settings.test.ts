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
    touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({ ...t })),
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
    bad.touchpoints[0] = { enabled: true, offset_ms: 30_000 } // 30s
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects offset_ms above 7 days', () => {
    const bad = validSettings()
    bad.touchpoints[6] = { enabled: true, offset_ms: 8 * 24 * 3_600_000 } // 8 days
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects non-strictly-increasing enabled rows', () => {
    const bad = validSettings()
    bad.touchpoints[1] = { enabled: true, offset_ms: 60_000 } // 1m, less than slot 0's 5m
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('ignores ordering of disabled rows', () => {
    const ok = validSettings()
    ok.touchpoints[1] = { enabled: false, offset_ms: 60_000 } // disabled, ignore
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
})

describe('resolveEnabledOffsets', () => {
  it('returns 7-entry snapshot with slots 0..6 on defaults', () => {
    const snap = resolveEnabledOffsets(DEFAULT_FOLLOWUP_SETTINGS)
    expect(snap).toHaveLength(7)
    expect(snap.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(snap[0].offset_ms).toBe(300_000)
    expect(snap[6].offset_ms).toBe(86_400_000)
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
    s.touchpoints[5] = { enabled: true, offset_ms: 86_400_000 } // 24h in slot 5
    s.touchpoints[6] = { enabled: true, offset_ms: 64_800_000 } // 18h in slot 6
    const snap = resolveEnabledOffsets(s)
    // resolver sorts by offset_ms ascending so 18h (slot 6) comes before 24h (slot 5)
    expect(snap.map((e) => e.offset_ms)).toEqual([
      300_000, 3_600_000, 18_000_000, 28_800_000, 43_200_000, 64_800_000, 86_400_000,
    ])
    expect(snap[5].slot).toBe(6)  // 18h entry came from slot 6
    expect(snap[6].slot).toBe(5)  // 24h entry came from slot 5
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
    const stored = { enabled: false, touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints }
    const admin = makeAdmin({ data: { followup_settings: stored }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(stored)
  })
})
