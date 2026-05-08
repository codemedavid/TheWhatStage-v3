'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { TemplateButton } from '@/lib/messenger-templates/types'
import { renderTemplate } from '@/lib/messenger-templates/types'
import type { VariableMap, VariableRule } from '@/lib/messenger-templates/render'

/* ── design tokens (matches the rest of the dashboard) ── */
const S = {
  serif:      'var(--font-instrument-serif)',
  mono:       'var(--font-geist-mono)',
  ink:        '#1A1915',
  ink2:       '#3F3D36',
  ink3:       '#6B6960',
  ink4:       '#9C9A90',
  border:     '#E8E6DE',
  accent:     '#1F7A4D',
  accentInk:  '#0F4A30',
  accentSoft: '#F2F8F4',
  surface:    '#FFFFFF',
  surface2:   '#F6F5F1',
  danger:     '#B91C1C',
  dangerSoft: '#FEF2F2',
  warn:       '#92400E',
  warnSoft:   '#FFFBEB',
}

/* ── types ── */
interface Stage { id: string; name: string }

interface DraftRow {
  lead_id: string
  thread_id: string
  name: string | null
  draft: string
  policy: string
  user_included: boolean
  user_edited?: boolean
}

interface ApprovedTemplate {
  id: string
  display_name: string
  name: string
  language: string
  body_text: string
  variable_count: number
  buttons: TemplateButton[]
}

interface ActionPageOption {
  id: string
  title: string
  slug: string
  kind: string
}

interface AgentClientProps {
  stages: Stage[]
  templates: ApprovedTemplate[]
  actionPages: ActionPageOption[]
}

interface Campaign {
  id: string
  command_text: string
  status: string
  total: number
  sent: number
  failed: number
  skipped: number
  created_at: string
  dispatched_at: string | null
  completed_at: string | null
}

interface CampaignMessage {
  id: string
  lead_id: string
  draft_text: string
  policy_at_preview: string
  policy_at_send: string | null
  user_edited: boolean
  status: string
  skip_reason: string | null
  error: string | null
  attempts: number
  sent_at: string | null
  created_at: string
  leads: { name: string | null } | null
}

/* ── helpers ── */
function policyBadge(policy: string) {
  if (policy === 'RESPONSE') return { label: 'Active', bg: '#DCFCE7', color: '#166534' }
  if (policy === 'OTN')      return { label: 'OTN',    bg: '#DBEAFE', color: '#1D4ED8' }
  if (policy.startsWith('paused:')) {
    const reason = policy.split(':')[1]
    return { label: `Skipped · ${reason}`, bg: '#F3F4F6', color: '#6B7280' }
  }
  return { label: policy, bg: '#F3F4F6', color: '#6B7280' }
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':   return { label: 'Completed',   bg: '#DCFCE7', color: '#166534' }
    case 'sending':     return { label: 'Sending',     bg: '#DBEAFE', color: '#1D4ED8' }
    case 'dispatching': return { label: 'Dispatching', bg: '#DBEAFE', color: '#1D4ED8' }
    case 'cancelled':   return { label: 'Cancelled',   bg: '#F3F4F6', color: '#6B7280' }
    case 'failed':      return { label: 'Failed',      bg: '#FEE2E2', color: '#B91C1C' }
    case 'previewing':  return { label: 'Draft',       bg: '#FEF3C7', color: '#92400E' }
    default:            return { label: status,        bg: '#F3F4F6', color: '#6B7280' }
  }
}

function msgStatusBadge(status: string) {
  switch (status) {
    case 'sent':      return { label: 'Sent',      bg: '#DCFCE7', color: '#166534' }
    case 'failed':    return { label: 'Failed',    bg: '#FEE2E2', color: '#B91C1C' }
    case 'skipped':   return { label: 'Skipped',   bg: '#F3F4F6', color: '#6B7280' }
    case 'cancelled': return { label: 'Cancelled', bg: '#F3F4F6', color: '#6B7280' }
    case 'pending':   return { label: 'Pending',   bg: '#DBEAFE', color: '#1D4ED8' }
    default:          return { label: status,      bg: '#F3F4F6', color: '#6B7280' }
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/* ── main component ── */
export function AgentClient({ stages, templates, actionPages }: AgentClientProps) {
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [, startTransition] = useTransition()

  // ── send mode ──
  const [sendMode, setSendMode] = useState<'per_lead_ai' | 'shared_template'>('shared_template')
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '')
  const [variableRules, setVariableRules] = useState<VariableMap>({})
  const [stageName, setStageName] = useState<string>('')
  const [lastActiveDays, setLastActiveDays] = useState<string>('')
  const [actionPageId, setActionPageId] = useState<string>('')

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  )

  // ── new campaign state ──
  const [command, setCommand]         = useState('')
  const [drafts, setDrafts]           = useState<DraftRow[]>([])
  const [campaignId, setCampaignId]   = useState<string | null>(null)
  const [phase, setPhase]             = useState<'idle' | 'loading' | 'preview' | 'sending' | 'done'>('idle')
  const [error, setError]             = useState<string | null>(null)
  const [progress, setProgress]       = useState<{ sent: number; total: number; failed: number; skipped: number } | null>(null)
  const [intent, setIntent]           = useState<{ instruction: string; ambiguities: string[] } | null>(null)
  const [audienceCount, setAudienceCount] = useState<number | null>(null)

  // ── history state ──
  const [campaigns, setCampaigns]         = useState<Campaign[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError]   = useState<string | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [messages, setMessages]           = useState<CampaignMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const esRef    = useRef<EventSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch('/api/agent/campaigns')
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json() as { campaigns: Campaign[] }
      setCampaigns(json.campaigns)
    } catch (err) {
      setHistoryError((err as Error).message)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const loadMessages = useCallback(async (campaign: Campaign) => {
    setSelectedCampaign(campaign)
    setMessages([])
    setMessagesLoading(true)
    setMessagesError(null)
    try {
      const res = await fetch(`/api/agent/campaigns/${campaign.id}/messages`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json() as { messages: CampaignMessage[] }
      setMessages(json.messages)
    } catch (err) {
      setMessagesError((err as Error).message)
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'history') startTransition(() => { void loadHistory() })
  }, [tab, loadHistory, startTransition])

  const includedCount = drafts.filter((d) => d.user_included).length

  /* ── start preview ── */
  const startPreview = useCallback(() => {
    if (phase === 'loading') return
    if (sendMode === 'per_lead_ai' && !command.trim()) return
    if (sendMode === 'shared_template' && !templateId) return
    esRef.current?.close()

    setPhase('loading')
    setError(null)
    setDrafts([])
    setCampaignId(null)
    setIntent(null)
    setAudienceCount(null)
    setProgress(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const previewBody: Record<string, unknown> =
      sendMode === 'shared_template'
        ? {
            mode: 'shared_template',
            templateId,
            templateVariables: variableRules,
            attachedActionPageId: actionPageId || null,
            stageName: stageName.trim() || null,
            lastActiveWithinDays: lastActiveDays ? Number(lastActiveDays) : null,
            // command_text is still persisted on the campaign row for history;
            // synthesize a human-readable label from the chosen template.
            command: selectedTemplate
              ? `[Template] ${selectedTemplate.display_name}`
              : '[Template]',
          }
        : { command }

    fetch('/api/agent/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(previewBody),
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        setError(`Preview failed: ${txt || res.statusText}`)
        setPhase('idle')
        return
      }

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf      = ''

      const processEvents = (chunk: string) => {
        buf += chunk
        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''
        for (const block of blocks) {
          const lines = block.split('\n')
          let event = 'message'
          let data  = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim()
            else if (line.startsWith('data: '))  data  = line.slice(6).trim()
          }
          if (!data) continue
          try {
            const payload = JSON.parse(data)
            handleEvent(event, payload)
          } catch { /* ignore parse errors */ }
        }
      }

      const handleEvent = (event: string, payload: Record<string, unknown>) => {
        if (event === 'campaign') {
          setCampaignId(payload.campaign_id as string)
          setPhase('preview')
        } else if (event === 'intent') {
          setIntent({
            instruction: payload.instruction as string,
            ambiguities: (payload.ambiguities as string[]) ?? [],
          })
        } else if (event === 'audience') {
          setAudienceCount(payload.count as number)
        } else if (event === 'draft') {
          setDrafts((prev) => [
            ...prev,
            {
              lead_id:      payload.lead_id as string,
              thread_id:    payload.thread_id as string,
              name:         payload.name as string | null,
              draft:        payload.draft as string,
              policy:       payload.policy as string,
              user_included: payload.user_included as boolean,
            },
          ])
        } else if (event === 'done') {
          setPhase('preview')
        } else if (event === 'error') {
          setError(payload.message as string)
          setPhase('idle')
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          processEvents(dec.decode(value, { stream: true }))
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message)
          setPhase('idle')
        }
      }
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message)
        setPhase('idle')
      }
    })
  }, [
    command,
    phase,
    sendMode,
    templateId,
    variableRules,
    actionPageId,
    stageName,
    lastActiveDays,
    selectedTemplate,
  ])

  /* ── send campaign ── */
  const sendCampaign = useCallback(async () => {
    if (!campaignId || drafts.length === 0) return
    setPhase('sending')
    setError(null)

    const res = await fetch(`/api/agent/campaigns/${campaignId}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: drafts }),
    }).catch((err) => { setError((err as Error).message); return null })

    if (!res || !res.ok) {
      const txt = await res?.text().catch(() => '')
      setError(`Dispatch failed: ${txt || 'unknown error'}`)
      setPhase('preview')
      return
    }

    // Start polling progress SSE.
    const es = new EventSource(`/api/agent/campaigns/${campaignId}/stream`)
    esRef.current = es

    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data) as { status: string; total: number; sent: number; failed: number; skipped: number }
        setProgress({ sent: data.sent, total: data.total, failed: data.failed, skipped: data.skipped })
        if (['completed', 'cancelled', 'failed'].includes(data.status)) {
          setPhase('done')
          es.close()
        }
      } catch { /* ignore */ }
    })

    es.onerror = () => {
      setPhase('done')
      es.close()
    }
  }, [campaignId, drafts])

  /* ── cancel ── */
  const cancel = useCallback(async () => {
    abortRef.current?.abort()
    esRef.current?.close()
    if (campaignId) {
      await fetch(`/api/agent/campaigns/${campaignId}/stream`, { method: 'DELETE' }).catch(() => {})
    }
    setPhase('idle')
  }, [campaignId])

  /* ── draft row controls ── */
  const toggleInclude = (leadId: string) =>
    setDrafts((prev) =>
      prev.map((d) => (d.lead_id === leadId ? { ...d, user_included: !d.user_included } : d)),
    )

  const editDraft = (leadId: string, text: string) =>
    setDrafts((prev) =>
      prev.map((d) =>
        d.lead_id === leadId ? { ...d, draft: text, user_edited: true } : d,
      ),
    )

  /* ── render ── */
  return (
    <>
      <style>{`
        .ag-wrap { max-width:900px; margin:0 auto; padding:28px 32px 80px; display:flex; flex-direction:column; gap:24px; }
        .ag-grid  { display:flex; flex-direction:column; gap:8px; }
        .ag-row   { display:grid; grid-template-columns:24px 1fr auto; gap:12px; align-items:flex-start; padding:14px 16px; background:${S.surface}; border:1px solid ${S.border}; border-radius:12px; }
        .ag-row.excluded { opacity:0.45; }
        .ag-hist-row { display:flex; flex-direction:column; gap:6px; padding:14px 16px; background:${S.surface}; border:1px solid ${S.border}; border-radius:12px; cursor:pointer; transition:border-color 150ms; }
        .ag-hist-row:hover { border-color:#C5C2BA; }
        @media(max-width:640px) {
          .ag-wrap { padding:16px 12px 60px; gap:18px; }
          .ag-row  { grid-template-columns:20px 1fr; }
          .ag-row-badge { display:none; }
        }
      `}</style>

      <div className="ag-wrap">

        {/* ── Header ── */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <h1 style={{ fontFamily:S.serif, fontSize:'clamp(24px,3.5vw,32px)', fontWeight:400, letterSpacing:'-0.015em', margin:0, color:S.ink }}>
              AI Follow-Up Agent
            </h1>
            <p style={{ margin:0, fontSize:13.5, color:S.ink3, maxWidth:600 }}>
              Describe who to reach and what to say — the agent drafts personalized Messenger messages for your review before sending.
            </p>
          </div>

          {/* Tab switcher */}
          <div style={{ display:'flex', gap:4, padding:3, background:S.surface2, borderRadius:10, border:`1px solid ${S.border}`, flexShrink:0 }}>
            {(['new', 'history'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding:'5px 14px', borderRadius:7, border:'none', fontSize:13,
                  fontWeight: tab === t ? 500 : 400,
                  background: tab === t ? S.surface : 'transparent',
                  color: tab === t ? S.ink : S.ink3,
                  cursor:'pointer',
                  boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {t === 'new' ? 'New Campaign' : 'History'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'new' && (<>

        {/* ── Send-mode toggle ── */}
        <div style={{ display:'flex', gap:4, padding:3, background:S.surface2, borderRadius:10, border:`1px solid ${S.border}`, alignSelf:'flex-start' }}>
          {([
            ['shared_template', 'Shared template'],
            ['per_lead_ai', 'AI per lead'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setSendMode(m)}
              style={{
                padding:'6px 14px', borderRadius:7, border:'none', fontSize:13,
                fontWeight: sendMode === m ? 500 : 400,
                background: sendMode === m ? S.surface : 'transparent',
                color: sendMode === m ? S.ink : S.ink3,
                cursor:'pointer',
                boxShadow: sendMode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Shared-template configurator ── */}
        {sendMode === 'shared_template' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 18px', background:S.surface, border:`1px solid ${S.border}`, borderRadius:12 }}>
            {templates.length === 0 ? (
              <p style={{ fontSize:13, color:S.ink3, margin:0 }}>
                No approved templates yet. Submit one for review at <a href="/dashboard/templates" style={{ color: S.accent }}>Templates</a>.
              </p>
            ) : (
              <>
                <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <span style={{ fontSize:12, fontWeight:500, color:S.ink2 }}>Template</span>
                  <select
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value)
                      setVariableRules({})
                    }}
                    style={{ padding:'8px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.display_name}</option>
                    ))}
                  </select>
                </label>

                {selectedTemplate && selectedTemplate.variable_count > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <span style={{ fontSize:12, fontWeight:500, color:S.ink2 }}>Variables</span>
                    {Array.from({ length: selectedTemplate.variable_count }).map((_, i) => {
                      const idx = String(i + 1)
                      const rule: VariableRule = variableRules[idx] ?? { kind: 'static', text: '' }
                      return (
                        <div key={idx} style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <span style={{ fontFamily:S.mono, fontSize:12, color:S.ink3, width:36 }}>{`{{${idx}}}`}</span>
                          <select
                            value={rule.kind}
                            onChange={(e) => {
                              const kind = e.target.value as VariableRule['kind']
                              setVariableRules({
                                ...variableRules,
                                [idx]: kind === 'static'
                                  ? { kind: 'static', text: '' }
                                  : { kind: 'lead_field', field: 'name' },
                              })
                            }}
                            style={{ padding:'6px 8px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:12, background:S.surface, color:S.ink }}
                          >
                            <option value="static">Same text</option>
                            <option value="lead_field">Lead field</option>
                          </select>
                          {rule.kind === 'static' ? (
                            <input
                              type="text"
                              value={rule.text}
                              onChange={(e) => setVariableRules({
                                ...variableRules,
                                [idx]: { kind: 'static', text: e.target.value },
                              })}
                              placeholder={`Value for {{${idx}}}`}
                              style={{ flex:1, padding:'6px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                            />
                          ) : (
                            <select
                              value={rule.field}
                              onChange={(e) => setVariableRules({
                                ...variableRules,
                                [idx]: { kind: 'lead_field', field: e.target.value },
                              })}
                              style={{ flex:1, padding:'6px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                            >
                              <option value="name">name</option>
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {selectedTemplate && (
                  <div style={{ background:S.surface2, padding:'10px 12px', borderRadius:8, border:`1px solid ${S.border}`, fontSize:13, color:S.ink2, lineHeight:1.5, whiteSpace:'pre-wrap' }}>
                    {renderTemplate(
                      selectedTemplate.body_text,
                      Array.from({ length: selectedTemplate.variable_count }).map((_, i) => {
                        const r = variableRules[String(i + 1)]
                        if (!r) return `{{${i + 1}}}`
                        if (r.kind === 'static') return r.text || `{{${i + 1}}}`
                        return `[lead.${r.field}]`
                      }),
                    )}
                  </div>
                )}

                {selectedTemplate && selectedTemplate.buttons.some((b) => b.type === 'url') && actionPages.length > 0 && (
                  <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    <span style={{ fontSize:12, fontWeight:500, color:S.ink2 }}>Attach action page (overrides URL button)</span>
                    <select
                      value={actionPageId}
                      onChange={(e) => setActionPageId(e.target.value)}
                      style={{ padding:'8px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                    >
                      <option value="">— none —</option>
                      {actionPages.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </label>
                )}

                <div style={{ display:'flex', gap:10 }}>
                  <label style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
                    <span style={{ fontSize:12, fontWeight:500, color:S.ink2 }}>Audience: stage</span>
                    <select
                      value={stageName}
                      onChange={(e) => setStageName(e.target.value)}
                      style={{ padding:'8px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                    >
                      <option value="">— any stage —</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
                    <span style={{ fontSize:12, fontWeight:500, color:S.ink2 }}>Active within (days)</span>
                    <input
                      type="number"
                      min={1}
                      value={lastActiveDays}
                      onChange={(e) => setLastActiveDays(e.target.value)}
                      placeholder="any"
                      style={{ padding:'8px 10px', borderRadius:6, border:`1px solid ${S.border}`, fontSize:13, background:S.surface, color:S.ink }}
                    />
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Stage chips ── */}
        {stages.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {stages.map((s) => (
              <button
                key={s.id}
                onClick={() => setCommand((c) => c ? c : `Follow up with all my ${s.name} leads`)}
                style={{ padding:'4px 10px', borderRadius:999, border:`1px solid ${S.border}`, background:S.surface2, fontSize:12, color:S.ink3, cursor:'pointer', fontFamily:S.mono }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* ── Command Bar ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {sendMode === 'per_lead_ai' && (
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startPreview() }}
              placeholder='e.g. "Follow up with all my Interested leads — remind them about our limited-time offer"'
              rows={3}
              style={{
                width:'100%', padding:'12px 14px', borderRadius:12,
                border:`1px solid ${S.border}`, fontFamily:'inherit', fontSize:14,
                color:S.ink, background:S.surface, resize:'vertical', outline:'none',
                lineHeight:1.5, boxSizing:'border-box',
              }}
              disabled={phase === 'sending'}
            />
          )}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:S.ink4 }}>
              {sendMode === 'per_lead_ai' ? 'Cmd+Enter to preview · ' : ''}Up to 200 leads
            </span>
            <div style={{ display:'flex', gap:8 }}>
              {phase !== 'idle' && phase !== 'done' && (
                <button
                  onClick={cancel}
                  style={{ padding:'8px 14px', borderRadius:8, border:`1px solid ${S.border}`, background:S.surface, fontSize:13, color:S.ink3, cursor:'pointer' }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={startPreview}
                disabled={
                  (sendMode === 'per_lead_ai' && !command.trim())
                  || (sendMode === 'shared_template' && !templateId)
                  || phase === 'loading' || phase === 'sending'
                }
                style={{
                  padding:'8px 18px', borderRadius:8, border:'none',
                  background: (
                    (sendMode === 'per_lead_ai' ? !command.trim() : !templateId)
                    || phase === 'loading'
                  ) ? S.surface2 : S.accent,
                  color: (
                    (sendMode === 'per_lead_ai' ? !command.trim() : !templateId)
                    || phase === 'loading'
                  ) ? S.ink4 : 'white',
                  fontSize:13, fontWeight:500,
                  cursor:
                    (sendMode === 'per_lead_ai' ? !command.trim() : !templateId)
                      ? 'default' : 'pointer',
                }}
              >
                {phase === 'loading' ? 'Generating…' : 'Preview'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ padding:'12px 16px', borderRadius:10, background:S.dangerSoft, border:`1px solid #FECACA`, color:S.danger, fontSize:13 }}>
            {error}
          </div>
        )}

        {/* ── Ambiguity warning ── */}
        {intent && intent.ambiguities.length > 0 && (
          <div style={{ padding:'12px 16px', borderRadius:10, background:S.warnSoft, border:`1px solid #FCD34D`, color:S.warn, fontSize:13 }}>
            <strong>Heads up:</strong> {intent.ambiguities.join(' · ')}
          </div>
        )}

        {/* ── Audience summary ── */}
        {(phase === 'loading' || phase === 'preview' || phase === 'sending' || phase === 'done') && (
          <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 16px', borderRadius:10, background:S.surface2, border:`1px solid ${S.border}`, flexWrap:'wrap' }}>
            {audienceCount != null && (
              <span style={{ fontSize:13, color:S.ink2 }}>
                <strong style={{ color:S.ink }}>{audienceCount}</strong> lead{audienceCount !== 1 ? 's' : ''} found
              </span>
            )}
            {drafts.length > 0 && (
              <span style={{ fontSize:13, color:S.ink2 }}>
                <strong style={{ color:S.ink }}>{drafts.length}</strong> drafts generated
              </span>
            )}
            {includedCount > 0 && phase === 'preview' && (
              <span style={{ fontSize:13, color:S.ink2 }}>
                <strong style={{ color:S.accentInk }}>{includedCount}</strong> selected for send
              </span>
            )}
            {phase === 'loading' && (
              <span style={{ fontSize:12, color:S.ink4, fontFamily:S.mono }}>
                Generating drafts…
              </span>
            )}
          </div>
        )}

        {/* ── Progress bar (sending/done) ── */}
        {(phase === 'sending' || phase === 'done') && progress && (
          <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'14px 16px', borderRadius:12, background:S.surface, border:`1px solid ${S.border}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:S.ink2 }}>
              <span>{phase === 'done' ? 'Sending complete' : 'Sending…'}</span>
              <span style={{ fontFamily:S.mono, color:S.ink4 }}>
                {progress.sent + progress.failed + progress.skipped} / {progress.total}
              </span>
            </div>
            <div style={{ height:6, background:S.surface2, borderRadius:999, overflow:'hidden' }}>
              <div style={{
                height:'100%',
                width: `${progress.total > 0 ? ((progress.sent + progress.failed + progress.skipped) / progress.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg,#1F7A4D,#2EA86A)',
                borderRadius:999,
                transition:'width 500ms',
              }} />
            </div>
            <div style={{ display:'flex', gap:16, fontSize:12, color:S.ink4 }}>
              <span><strong style={{ color:S.accentInk }}>{progress.sent}</strong> sent</span>
              {progress.skipped > 0 && <span><strong style={{ color:S.ink3 }}>{progress.skipped}</strong> skipped</span>}
              {progress.failed > 0 && <span><strong style={{ color:S.danger }}>{progress.failed}</strong> failed</span>}
            </div>
          </div>
        )}

        {/* ── Draft grid ── */}
        {drafts.length > 0 && phase !== 'sending' && phase !== 'done' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <h2 style={{ fontFamily:S.serif, fontSize:20, fontWeight:400, margin:0, color:S.ink }}>
                Review Drafts
              </h2>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  onClick={() => setDrafts((p) => p.map((d) => ({ ...d, user_included: true })))}
                  style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${S.border}`, background:S.surface, fontSize:12, color:S.ink3, cursor:'pointer' }}
                >
                  Select all
                </button>
                <button
                  onClick={() => setDrafts((p) => p.map((d) => ({ ...d, user_included: false })))}
                  style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${S.border}`, background:S.surface, fontSize:12, color:S.ink3, cursor:'pointer' }}
                >
                  Deselect all
                </button>
              </div>
            </div>

            <div className="ag-grid">
              {drafts.map((row) => {
                const badge = policyBadge(row.policy)
                const paused = row.policy.startsWith('paused:')
                return (
                  <div
                    key={row.lead_id}
                    className={`ag-row${!row.user_included ? ' excluded' : ''}`}
                  >
                    {/* Checkbox */}
                    <div style={{ paddingTop:2 }}>
                      <input
                        type="checkbox"
                        checked={row.user_included && !paused}
                        disabled={paused}
                        onChange={() => !paused && toggleInclude(row.lead_id)}
                        style={{ width:16, height:16, accentColor:S.accent, cursor: paused ? 'default' : 'pointer' }}
                      />
                    </div>

                    {/* Content */}
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span style={{ fontSize:13.5, fontWeight:600, color:S.ink }}>
                          {row.name ?? 'Unknown'}
                        </span>
                        <span
                          className="ag-row-badge"
                          style={{
                            fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:999,
                            background:badge.bg, color:badge.color, fontFamily:S.mono,
                          }}
                        >
                          {badge.label}
                        </span>
                        {row.user_edited && (
                          <span style={{ fontSize:11, color:S.ink4, fontFamily:S.mono }}>edited</span>
                        )}
                      </div>
                      {paused ? (
                        <span style={{ fontSize:13, color:S.ink4, fontStyle:'italic' }}>
                          {row.policy === 'paused:window' && 'Outside 24h window — no opt-in or OTN token.'}
                          {row.policy === 'paused:cooldown' && 'Contacted within the last 48 hours.'}
                          {row.policy === 'paused:cap' && 'Daily send cap reached.'}
                          {row.policy === 'paused:optin' && 'No marketing opt-in on file.'}
                        </span>
                      ) : (
                        <textarea
                          value={row.draft}
                          onChange={(e) => editDraft(row.lead_id, e.target.value)}
                          rows={2}
                          style={{
                            width:'100%', padding:'8px 10px', borderRadius:8,
                            border:`1px solid ${S.border}`, fontFamily:'inherit',
                            fontSize:13.5, color:S.ink2, background: row.user_included ? S.surface : S.surface2,
                            resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box',
                          }}
                        />
                      )}
                    </div>

                    {/* Policy badge on desktop */}
                    <div className="ag-row-badge" />
                  </div>
                )
              })}
            </div>

            {/* Send button */}
            {includedCount > 0 && (
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <button
                  onClick={sendCampaign}
                  style={{
                    padding:'10px 24px', borderRadius:10, border:'none',
                    background:S.accent, color:'white', fontSize:14, fontWeight:500, cursor:'pointer',
                  }}
                >
                  Send {includedCount} message{includedCount !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Done state ── */}
        {phase === 'done' && (
          <div style={{ display:'flex', justifyContent:'center', gap:10, paddingTop:16 }}>
            <button
              onClick={() => { setPhase('idle'); setDrafts([]); setCampaignId(null); setProgress(null); setIntent(null); setAudienceCount(null); }}
              style={{ padding:'9px 20px', borderRadius:9, border:`1px solid ${S.border}`, background:S.surface, fontSize:13, color:S.ink2, cursor:'pointer' }}
            >
              New campaign
            </button>
            <button
              onClick={() => { setPhase('idle'); setDrafts([]); setCampaignId(null); setProgress(null); setIntent(null); setAudienceCount(null); setTab('history'); }}
              style={{ padding:'9px 20px', borderRadius:9, border:'none', background:S.accentSoft, fontSize:13, color:S.accentInk, cursor:'pointer', fontWeight:500 }}
            >
              View history
            </button>
          </div>
        )}

        </>)}

        {/* ── History tab ── */}
        {tab === 'history' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Campaign detail view */}
            {selectedCampaign ? (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <button
                    onClick={() => { setSelectedCampaign(null); setMessages([]); }}
                    style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${S.border}`, background:S.surface, fontSize:12, color:S.ink3, cursor:'pointer' }}
                  >
                    ← Back
                  </button>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:13, color:S.ink, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {selectedCampaign.command_text}
                    </p>
                    <p style={{ margin:0, fontSize:11, color:S.ink4, fontFamily:S.mono }}>
                      {fmtDate(selectedCampaign.created_at)}
                    </p>
                  </div>
                  {(() => {
                    const b = statusBadge(selectedCampaign.status)
                    return (
                      <span style={{ fontSize:11, fontWeight:500, padding:'3px 10px', borderRadius:999, background:b.bg, color:b.color, flexShrink:0 }}>
                        {b.label}
                      </span>
                    )
                  })()}
                </div>

                {/* summary row */}
                <div style={{ display:'flex', gap:16, padding:'10px 14px', borderRadius:10, background:S.surface2, border:`1px solid ${S.border}`, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, color:S.ink2 }}><strong style={{ color:S.accentInk }}>{selectedCampaign.sent}</strong> sent</span>
                  {selectedCampaign.failed > 0 && <span style={{ fontSize:13, color:S.ink2 }}><strong style={{ color:S.danger }}>{selectedCampaign.failed}</strong> failed</span>}
                  {selectedCampaign.skipped > 0 && <span style={{ fontSize:13, color:S.ink2 }}><strong style={{ color:S.ink3 }}>{selectedCampaign.skipped}</strong> skipped</span>}
                  <span style={{ fontSize:13, color:S.ink2 }}><strong style={{ color:S.ink }}>{selectedCampaign.total}</strong> total</span>
                </div>

                {messagesLoading && (
                  <p style={{ fontSize:13, color:S.ink4, textAlign:'center', margin:0 }}>Loading messages…</p>
                )}
                {messagesError && (
                  <div style={{ padding:'10px 14px', borderRadius:10, background:S.dangerSoft, color:S.danger, fontSize:13 }}>
                    {messagesError}
                  </div>
                )}

                {messages.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {messages.map((m) => {
                      const b = msgStatusBadge(m.status)
                      const name = m.leads?.name ?? 'Unknown'
                      return (
                        <div key={m.id} style={{ padding:'12px 14px', borderRadius:10, background:S.surface, border:`1px solid ${S.border}`, display:'flex', flexDirection:'column', gap:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:13, fontWeight:600, color:S.ink }}>{name}</span>
                            <span style={{ fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:999, background:b.bg, color:b.color, fontFamily:S.mono }}>
                              {b.label}
                            </span>
                            {m.user_edited && (
                              <span style={{ fontSize:11, color:S.ink4, fontFamily:S.mono }}>edited</span>
                            )}
                            {m.sent_at && (
                              <span style={{ fontSize:11, color:S.ink4, marginLeft:'auto' }}>{fmtDate(m.sent_at)}</span>
                            )}
                          </div>
                          <p style={{ margin:0, fontSize:13, color:S.ink2, lineHeight:1.5 }}>{m.draft_text}</p>
                          {(m.error || m.skip_reason) && (
                            <p style={{ margin:0, fontSize:12, color: m.error ? S.danger : S.ink3, fontFamily:S.mono }}>
                              {m.error ?? m.skip_reason}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {!messagesLoading && !messagesError && messages.length === 0 && (
                  <p style={{ fontSize:13, color:S.ink4, textAlign:'center', margin:0 }}>No messages found for this campaign.</p>
                )}
              </>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <h2 style={{ fontFamily:S.serif, fontSize:20, fontWeight:400, margin:0, color:S.ink }}>Campaign History</h2>
                  <button
                    onClick={loadHistory}
                    disabled={historyLoading}
                    style={{ padding:'5px 12px', borderRadius:7, border:`1px solid ${S.border}`, background:S.surface, fontSize:12, color:S.ink3, cursor:'pointer' }}
                  >
                    {historyLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>

                {historyError && (
                  <div style={{ padding:'10px 14px', borderRadius:10, background:S.dangerSoft, color:S.danger, fontSize:13 }}>
                    {historyError}
                  </div>
                )}

                {!historyLoading && campaigns.length === 0 && !historyError && (
                  <p style={{ fontSize:13, color:S.ink4, textAlign:'center', margin:'24px 0' }}>
                    No campaigns yet. Create your first one in the New Campaign tab.
                  </p>
                )}

                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {campaigns.map((c) => {
                    const b = statusBadge(c.status)
                    return (
                      <div key={c.id} className="ag-hist-row" onClick={() => loadMessages(c)}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:999, background:b.bg, color:b.color, fontFamily:S.mono, flexShrink:0 }}>
                            {b.label}
                          </span>
                          <span style={{ fontSize:12, color:S.ink4, fontFamily:S.mono }}>{fmtDate(c.created_at)}</span>
                        </div>
                        <p style={{ margin:0, fontSize:13.5, color:S.ink, lineHeight:1.4 }}>{c.command_text}</p>
                        <div style={{ display:'flex', gap:14, fontSize:12, color:S.ink4 }}>
                          <span><strong style={{ color:S.accentInk }}>{c.sent}</strong> sent</span>
                          {c.failed > 0 && <span><strong style={{ color:S.danger }}>{c.failed}</strong> failed</span>}
                          {c.skipped > 0 && <span><strong style={{ color:S.ink3 }}>{c.skipped}</strong> skipped</span>}
                          <span style={{ marginLeft:'auto' }}>{c.total} total</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

          </div>
        )}

      </div>
    </>
  )
}
