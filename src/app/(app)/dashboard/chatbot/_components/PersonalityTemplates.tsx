'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PersonalityTemplate, GeneratedPersonalityConfig } from '@/lib/chatbot/personality/types'
import { adoptPersonality, applyAdoption, revertAdoption } from '../personality-actions'

// ---------------------------------------------------------------------------
// Template Grid (browse view)
// ---------------------------------------------------------------------------
type BrowseViewProps = {
  templates: PersonalityTemplate[]
  onSelect: (t: PersonalityTemplate) => void
  onClose: () => void
}

function BrowseView({ templates, onSelect, onClose }: BrowseViewProps) {
  return (
    <div className="pt-overlay">
      <div className="pt-dialog pt-dialog-wide">
        <div className="pt-dialog-head">
          <div>
            <h2 className="pt-dialog-title">Personality Templates</h2>
            <p className="pt-dialog-sub">Choose a voice archetype — the AI will adapt it to your business.</p>
          </div>
          <button className="pt-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pt-grid">
          {templates.map((t) => (
            <button key={t.id} className="pt-card" onClick={() => onSelect(t)}>
              <div className="pt-card-emoji">{t.avatarEmoji}</div>
              <div className="pt-card-body">
                <div className="pt-card-name">{t.name}</div>
                <div className="pt-card-inspired">Inspired by {t.inspiredBy}</div>
                <div className="pt-card-tagline">{t.tagline}</div>
                <div className="pt-card-tags">
                  {t.bestFor.slice(0, 3).map((tag) => (
                    <span key={tag} className="pt-tag">{tag}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview view (before adapting)
// ---------------------------------------------------------------------------
type PreviewViewProps = {
  template: PersonalityTemplate
  adapting: boolean
  onAdapt: () => void
  onBack: () => void
  onClose: () => void
}

function PreviewView({ template, adapting, onAdapt, onBack, onClose }: PreviewViewProps) {
  return (
    <div className="pt-overlay">
      <div className="pt-dialog">
        <div className="pt-dialog-head">
          <button className="pt-back" onClick={onBack}>← Back</button>
          <button className="pt-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pt-preview-hero">
          <span className="pt-preview-emoji">{template.avatarEmoji}</span>
          <div>
            <h2 className="pt-preview-name">{template.name}</h2>
            <p className="pt-preview-inspired">Inspired by {template.inspiredBy}</p>
          </div>
        </div>
        <p className="pt-preview-tagline">{template.tagline}</p>
        <div className="pt-preview-sample">
          <div className="pt-preview-label">Sample persona</div>
          <p className="pt-preview-text">{template.samplePersona}</p>
        </div>
        <div className="pt-preview-phrases">
          <div className="pt-preview-label">Signature phrases</div>
          <ul className="pt-phrase-list">
            {template.signaturePhrases.map((p, i) => (
              <li key={i} className="pt-phrase">&ldquo;{p}&rdquo;</li>
            ))}
          </ul>
        </div>
        <div className="pt-preview-actions">
          <p className="pt-preview-hint">
            The AI will read your products, knowledge base, and current instructions to personalize this for your business.
          </p>
          <button
            className="pt-btn pt-btn-primary"
            onClick={onAdapt}
            disabled={adapting}
          >
            {adapting ? 'Adapting for your business…' : `Adapt "${template.name}" for my business`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diff / Review view (after adapting)
// ---------------------------------------------------------------------------
type DiffViewProps = {
  template: PersonalityTemplate
  config: GeneratedPersonalityConfig
  notes: string
  adoptionId: string
  applying: boolean
  onApply: (edited: GeneratedPersonalityConfig) => void
  onBack: () => void
  onClose: () => void
}

function DiffView({ template, config, notes, applying, onApply, onBack, onClose }: DiffViewProps) {
  const [edited, setEdited] = useState<GeneratedPersonalityConfig>(config)

  function update<K extends keyof GeneratedPersonalityConfig>(key: K, value: GeneratedPersonalityConfig[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }))
  }

  function updateRule(list: 'doRules' | 'dontRules', index: number, value: string) {
    setEdited((prev) => {
      const next = [...prev[list]]
      next[index] = value
      return { ...prev, [list]: next }
    })
  }

  function addRule(list: 'doRules' | 'dontRules') {
    setEdited((prev) => ({ ...prev, [list]: [...prev[list], ''] }))
  }

  function removeRule(list: 'doRules' | 'dontRules', index: number) {
    setEdited((prev) => ({ ...prev, [list]: prev[list].filter((_, i) => i !== index) }))
  }

  return (
    <div className="pt-overlay">
      <div className="pt-dialog pt-dialog-wide">
        <div className="pt-dialog-head">
          <button className="pt-back" onClick={onBack}>← Back</button>
          <button className="pt-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="pt-diff-header">
          <span className="pt-diff-emoji">{template.avatarEmoji}</span>
          <div>
            <h2 className="pt-dialog-title">Review your adapted persona</h2>
            <p className="pt-dialog-sub">Edit any field before applying.</p>
          </div>
        </div>

        {notes && (
          <div className="pt-notes-banner">
            <span className="pt-notes-icon">✦</span>
            <p className="pt-notes-text">{notes}</p>
          </div>
        )}

        <div className="pt-diff-body">
          <div className="pt-diff-field">
            <label className="pt-diff-label">Assistant name</label>
            <input
              className="pt-diff-input"
              value={edited.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>

          <div className="pt-diff-field">
            <label className="pt-diff-label">Persona</label>
            <textarea
              className="pt-diff-textarea"
              rows={4}
              value={edited.persona}
              onChange={(e) => update('persona', e.target.value)}
            />
          </div>

          <div className="pt-diff-field">
            <label className="pt-diff-label">Instructions</label>
            <textarea
              className="pt-diff-textarea"
              rows={4}
              value={edited.instructions}
              onChange={(e) => update('instructions', e.target.value)}
            />
          </div>

          <div className="pt-diff-rules-row">
            <div className="pt-diff-rules-col">
              <div className="pt-diff-label">DO rules</div>
              {edited.doRules.map((rule, i) => (
                <div key={i} className="pt-rule-row">
                  <input
                    className="pt-diff-input"
                    value={rule}
                    onChange={(e) => updateRule('doRules', i, e.target.value)}
                  />
                  <button className="pt-rule-remove" onClick={() => removeRule('doRules', i)}>✕</button>
                </div>
              ))}
              <button className="pt-rule-add" onClick={() => addRule('doRules')}>+ Add rule</button>
            </div>

            <div className="pt-diff-rules-col">
              <div className="pt-diff-label">DON&apos;T rules</div>
              {edited.dontRules.map((rule, i) => (
                <div key={i} className="pt-rule-row">
                  <input
                    className="pt-diff-input"
                    value={rule}
                    onChange={(e) => updateRule('dontRules', i, e.target.value)}
                  />
                  <button className="pt-rule-remove" onClick={() => removeRule('dontRules', i)}>✕</button>
                </div>
              ))}
              <button className="pt-rule-add" onClick={() => addRule('dontRules')}>+ Add rule</button>
            </div>
          </div>

          <div className="pt-diff-field">
            <label className="pt-diff-label">Fallback message</label>
            <input
              className="pt-diff-input"
              value={edited.fallbackMessage}
              onChange={(e) => update('fallbackMessage', e.target.value)}
            />
          </div>

          <div className="pt-diff-field pt-diff-field-row">
            <label className="pt-diff-label">Suggested temperature</label>
            <input
              className="pt-diff-input pt-diff-input-sm"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={edited.suggestedTemperature}
              onChange={(e) => update('suggestedTemperature', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="pt-diff-actions">
          <button className="pt-btn pt-btn-ghost" onClick={onBack} disabled={applying}>
            Discard
          </button>
          <button
            className="pt-btn pt-btn-primary"
            onClick={() => onApply(edited)}
            disabled={applying}
          >
            {applying ? 'Applying…' : 'Apply to my chatbot'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active template badge (shown on ConfigForm when a template is applied)
// ---------------------------------------------------------------------------
type ActiveTemplateBadgeProps = {
  template: PersonalityTemplate
  adoptionId: string
  onBrowse: () => void
}

function ActiveTemplateBadge({ template, adoptionId, onBrowse }: ActiveTemplateBadgeProps) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleRevert() {
    startTransition(async () => {
      await revertAdoption(adoptionId)
      router.refresh()
    })
  }

  return (
    <div className="pt-active-badge">
      <span className="pt-active-emoji">{template.avatarEmoji}</span>
      <span className="pt-active-name">
        Powered by <strong>{template.name}</strong>
      </span>
      <div className="pt-active-actions">
        <button className="pt-active-btn" onClick={onBrowse}>Change</button>
        <button className="pt-active-btn pt-active-btn-danger" onClick={handleRevert} disabled={pending}>
          {pending ? 'Reverting…' : 'Revert'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root orchestrator
// ---------------------------------------------------------------------------
type View = 'closed' | 'browse' | 'preview' | 'diff'

type PersonalityTemplatesProps = {
  templates: PersonalityTemplate[]
  activeTemplate: PersonalityTemplate | null
  activeAdoptionId: string | null
}

export function PersonalityTemplates({
  templates,
  activeTemplate,
  activeAdoptionId,
}: PersonalityTemplatesProps) {
  const router = useRouter()
  const [view, setView] = useState<View>('closed')
  const [selected, setSelected] = useState<PersonalityTemplate | null>(null)
  const [adapting, startAdapting] = useTransition()
  const [applying, startApplying] = useTransition()
  const [draft, setDraft] = useState<{
    adoptionId: string
    config: GeneratedPersonalityConfig
    notes: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function open() {
    setError(null)
    setView('browse')
  }

  function close() {
    setView('closed')
    setSelected(null)
    setDraft(null)
    setError(null)
  }

  function selectTemplate(t: PersonalityTemplate) {
    setSelected(t)
    setView('preview')
  }

  function handleAdapt() {
    if (!selected) return
    setError(null)
    startAdapting(async () => {
      const result = await adoptPersonality(selected.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDraft({ adoptionId: result.adoptionId, config: result.config, notes: result.notes })
      setView('diff')
    })
  }

  function handleApply(edited: GeneratedPersonalityConfig) {
    if (!draft || !selected) return
    startApplying(async () => {
      const result = await applyAdoption(draft.adoptionId, selected.id, edited)
      if (!result.ok) {
        setError(result.error)
        return
      }
      close()
      router.refresh()
    })
  }

  return (
    <>
      {/* Badge or browse button */}
      <div className="pt-toolbar">
        {activeTemplate && activeAdoptionId ? (
          <ActiveTemplateBadge
            template={activeTemplate}
            adoptionId={activeAdoptionId}
            onBrowse={open}
          />
        ) : (
          <button className="pt-browse-btn" onClick={open}>
            ✦ Try a personality template
          </button>
        )}
      </div>

      {error && (
        <div className="pt-error-banner">{error}</div>
      )}

      {/* Modal views */}
      {view === 'browse' && (
        <BrowseView
          templates={templates}
          onSelect={selectTemplate}
          onClose={close}
        />
      )}

      {view === 'preview' && selected && (
        <PreviewView
          template={selected}
          adapting={adapting}
          onAdapt={handleAdapt}
          onBack={() => setView('browse')}
          onClose={close}
        />
      )}

      {view === 'diff' && selected && draft && (
        <DiffView
          template={selected}
          config={draft.config}
          notes={draft.notes}
          adoptionId={draft.adoptionId}
          applying={applying}
          onApply={handleApply}
          onBack={() => setView('preview')}
          onClose={close}
        />
      )}
    </>
  )
}
