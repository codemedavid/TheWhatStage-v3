'use client'

import Link from 'next/link'
import { useId, useMemo, useState } from 'react'
import type {
  ActionPageOption,
  CampaignRow,
  FunnelRow,
  LeadFieldOption,
} from '../_lib/queries'
import type { FunnelRule, Requirement } from '../_lib/schemas'
import { deleteFunnel, updateFunnel } from '../actions/funnel'

type Banner = { kind: 'error' | 'saved'; text: string } | null

export function FunnelEditorShell({
  campaign,
  funnel,
  actionPages,
  leadFields,
  siblings,
  banner,
}: {
  campaign: CampaignRow
  funnel: FunnelRow
  actionPages: ActionPageOption[]
  leadFields: LeadFieldOption[]
  siblings: FunnelRow[]
  banner: Banner
}) {
  const fid = useId()
  const [requirements, setRequirements] = useState<Requirement[]>(
    funnel.requirements ?? [],
  )
  const [rules, setRules] = useState<FunnelRule[]>(funnel.rules ?? [])
  const [actionPageId, setActionPageId] = useState<string>(
    funnel.action_page_id ?? '',
  )
  const [nextFunnelId, setNextFunnelId] = useState<string>(
    funnel.next_funnel_id ?? '',
  )

  const goalOptions = actionPages.filter((p) => p.status !== 'archived')
  const usableTextLeadFields = useMemo(
    () => leadFields.filter((f) => f.type === 'text'),
    [leadFields],
  )

  return (
    <div data-funnels-root>
      <div className="fn-wrap">
        <header className="fn-head">
          <div className="fn-head-copy">
            <div className="fn-eyebrow">
              <Link href="/dashboard/funnels">Workspace · Funnels</Link>
              <span aria-hidden> · </span>
              <Link href={`/dashboard/funnels/${campaign.id}`}>{campaign.name}</Link>
              <span aria-hidden> · </span>
              <span>{funnel.name}</span>
            </div>
            <h1>{funnel.name}</h1>
            <p>
              Set the questions this funnel must answer, the rules to layer on
              top of the campaign personality, and the instruction the bot
              follows while this funnel is active.
            </p>
          </div>
          <div className="fn-actions">
            <Link
              href={`/dashboard/funnels/${campaign.id}`}
              className="fn-btn fn-btn-ghost"
            >
              Back to campaign
            </Link>
          </div>
        </header>

        {banner && (
          <div className={`fnl-banner ${banner.kind}`} role="status">
            {banner.text}
          </div>
        )}

        <form action={updateFunnel} className="fnl-form-card">
          <input type="hidden" name="id" value={funnel.id} />
          <input type="hidden" name="campaign_id" value={campaign.id} />
          <input
            type="hidden"
            name="requirements"
            value={JSON.stringify(requirements)}
          />
          <input type="hidden" name="rules" value={JSON.stringify(rules)} />
          <input type="hidden" name="action_page_id" value={actionPageId} />
          <input type="hidden" name="next_funnel_id" value={nextFunnelId} />

          <div className="fnl-form-row">
            <div className="fnl-field">
              <label htmlFor={`${fid}-name`}>Name</label>
              <input
                id={`${fid}-name`}
                name="name"
                type="text"
                required
                minLength={1}
                maxLength={120}
                defaultValue={funnel.name}
              />
            </div>
          </div>
          <div className="fnl-field">
            <label htmlFor={`${fid}-desc`}>Purpose</label>
            <textarea
              id={`${fid}-desc`}
              name="description"
              rows={2}
              maxLength={2000}
              placeholder="What this funnel does. e.g. Qualify before pricing."
              defaultValue={funnel.description ?? ''}
            />
          </div>

          <RequirementsEditor
            value={requirements}
            onChange={setRequirements}
            leadFields={usableTextLeadFields}
          />

          <RulesEditor value={rules} onChange={setRules} />

          <fieldset className="fnl-fieldset">
            <legend>Instruction</legend>
            <p className="fnl-hint">
              Free-form prompt the chatbot follows while this funnel is
              active. Concatenated into the system prompt alongside the
              campaign personality and the rules above. e.g.{' '}
              <i>
                &ldquo;Pitch the strategy call. Lead with the outcome,
                close with a soft ask. Keep it under 3 sentences.&rdquo;
              </i>
            </p>
            <div className="fnl-field">
              <textarea
                name="instruction"
                rows={5}
                maxLength={4000}
                defaultValue={funnel.instruction ?? ''}
                placeholder="Describe what the bot should do during this funnel."
              />
            </div>
          </fieldset>

          <fieldset className="fnl-fieldset">
            <legend>Terminal action page</legend>
            <p className="fnl-hint">
              Sent when all required questions are answered and the flow has
              played. Optional — leave empty if this funnel only chains into
              the next one.
            </p>
            <select
              value={actionPageId}
              onChange={(e) => setActionPageId(e.target.value)}
            >
              <option value="">— None —</option>
              {goalOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.kind})
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="fnl-fieldset">
            <legend>Next funnel</legend>
            <p className="fnl-hint">
              When this one finishes, where does the lead go? Leave empty to
              end the campaign.
            </p>
            <select
              value={nextFunnelId}
              onChange={(e) => setNextFunnelId(e.target.value)}
            >
              <option value="">— End of campaign —</option>
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </fieldset>

          <div className="fnl-form-foot">
            <DeleteFunnelButton funnelId={funnel.id} campaignId={campaign.id} />
            <button type="submit" className="fn-btn fn-btn-primary">
              Save funnel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RequirementsEditor({
  value,
  onChange,
  leadFields,
}: {
  value: Requirement[]
  onChange: (v: Requirement[]) => void
  leadFields: LeadFieldOption[]
}) {
  function update(idx: number, patch: Partial<Requirement>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function add() {
    if (value.length >= 20) return
    onChange([
      ...value,
      {
        key: `q${value.length + 1}`,
        label: `Question ${value.length + 1}`,
        question: '',
        lead_field_key: leadFields[0]?.key ?? '',
        required: true,
      },
    ])
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <fieldset className="fnl-fieldset">
      <legend>Requirements</legend>
      <p className="fnl-hint">
        Questions the bot must get answered before sending the action page.
        Answers are saved to the lead&apos;s custom fields.
      </p>

      {leadFields.length === 0 && (
        <div className="fnl-banner warn">
          No text lead fields defined yet — go to{' '}
          <Link href="/dashboard/leads/fields">Leads · Fields</Link> to create
          one before adding requirements.
        </div>
      )}

      {value.length === 0 ? (
        <div className="fnl-aside-empty small">No requirements yet.</div>
      ) : (
        <div className="fnl-rows">
          {value.map((r, i) => (
            <div key={i} className="fnl-row">
              <div className="fnl-row-grid">
                <div className="fnl-field tight">
                  <label>Key</label>
                  <input
                    type="text"
                    value={r.key}
                    onChange={(e) => update(i, { key: e.target.value })}
                    pattern="^[a-z][a-z0-9_]*$"
                    maxLength={40}
                  />
                </div>
                <div className="fnl-field tight">
                  <label>Label</label>
                  <input
                    type="text"
                    value={r.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    maxLength={80}
                  />
                </div>
                <div className="fnl-field tight">
                  <label>Lead field</label>
                  <select
                    value={r.lead_field_key}
                    onChange={(e) =>
                      update(i, { lead_field_key: e.target.value })
                    }
                  >
                    {leadFields.length === 0 && <option value="">—</option>}
                    {leadFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.key})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fnl-field tight checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={r.required}
                      onChange={(e) =>
                        update(i, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                </div>
              </div>
              <div className="fnl-field">
                <label>Question to ask</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={r.question}
                  placeholder="e.g. Ano po pangalan ng business niyo?"
                  onChange={(e) => update(i, { question: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="fnl-row-remove"
                onClick={() => remove(i)}
                aria-label="Remove requirement"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="fn-btn fn-btn-secondary"
        onClick={add}
        disabled={value.length >= 20 || leadFields.length === 0}
      >
        + Add requirement
      </button>
    </fieldset>
  )
}

function RulesEditor({
  value,
  onChange,
}: {
  value: FunnelRule[]
  onChange: (v: FunnelRule[]) => void
}) {
  function update(idx: number, patch: Partial<FunnelRule>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function add(kind: 'do' | 'dont') {
    if (value.length >= 20) return
    onChange([...value, { kind, text: '' }])
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <fieldset className="fnl-fieldset">
      <legend>Rules</legend>
      <p className="fnl-hint">
        Layered on top of the campaign personality while this funnel is
        active. e.g. &quot;Don&apos;t reveal pricing yet.&quot;
      </p>

      {value.length === 0 ? (
        <div className="fnl-aside-empty small">No rules yet.</div>
      ) : (
        <div className="fnl-rows">
          {value.map((r, i) => (
            <div key={i} className="fnl-row tight">
              <div className="fnl-row-grid kind">
                <div className="fnl-field tight">
                  <label>Kind</label>
                  <select
                    value={r.kind}
                    onChange={(e) =>
                      update(i, { kind: e.target.value as 'do' | 'dont' })
                    }
                  >
                    <option value="do">DO</option>
                    <option value="dont">DON&apos;T</option>
                  </select>
                </div>
                <div className="fnl-field">
                  <label>Text</label>
                  <input
                    type="text"
                    value={r.text}
                    maxLength={280}
                    onChange={(e) => update(i, { text: e.target.value })}
                    placeholder="e.g. Don't drop the price before qualifying."
                  />
                </div>
              </div>
              <button
                type="button"
                className="fnl-row-remove"
                onClick={() => remove(i)}
                aria-label="Remove rule"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="fnl-row-actions">
        <button
          type="button"
          className="fn-btn fn-btn-secondary"
          onClick={() => add('do')}
          disabled={value.length >= 20}
        >
          + Add DO
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-secondary"
          onClick={() => add('dont')}
          disabled={value.length >= 20}
        >
          + Add DON&apos;T
        </button>
      </div>
    </fieldset>
  )
}


function DeleteFunnelButton({
  funnelId: _funnelId,
  campaignId: _campaignId,
}: {
  funnelId: string
  campaignId: string
}) {
  return (
    <button
      type="submit"
      formAction={deleteFunnel}
      formNoValidate
      className="fn-btn fn-btn-danger"
      onClick={(e) => {
        if (!window.confirm('Delete this funnel? This cannot be undone.'))
          e.preventDefault()
      }}
    >
      Delete funnel
    </button>
  )
}
