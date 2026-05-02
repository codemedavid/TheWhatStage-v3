'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import type {
  ActionPageOption,
  CampaignRow,
  FunnelRow,
} from '../_lib/queries'
import { deleteCampaign, updateCampaign } from '../actions/campaign'
import { createFunnel, deleteFunnel } from '../actions/funnel'

type Banner = { kind: 'error' | 'saved'; text: string } | null

export function CampaignEditor({
  campaign,
  funnels,
  actionPages,
  banner,
}: {
  campaign: CampaignRow
  funnels: FunnelRow[]
  actionPages: ActionPageOption[]
  banner: Banner
}) {
  const [enabled, setEnabled] = useState(campaign.enabled)
  const [personalityMode, setPersonalityMode] = useState(campaign.personality_mode)
  const [assignmentMode, setAssignmentMode] = useState(campaign.assignment_mode)
  const fid = useId()

  const goalOptions = actionPages.filter((p) => p.status !== 'archived')

  return (
    <div data-funnels-root>
      <div className="fn-wrap">
        <header className="fn-head">
          <div className="fn-head-copy">
            <div className="fn-eyebrow">
              <Link href="/dashboard/funnels">Workspace · Funnels</Link>
              <span aria-hidden> · </span>
              <span>{campaign.name}</span>
            </div>
            <h1>{campaign.name}</h1>
            <p>{campaign.description || 'No description.'}</p>
          </div>
          <div className="fn-actions">
            <span className={`fn-status ${campaign.status}`}>{campaign.status}</span>
            <span className={`fnl-toggle small${enabled ? ' on' : ''}`} aria-hidden>
              <span className="fnl-toggle-knob" />
              <span className="fnl-toggle-label">{enabled ? 'Enabled' : 'Disabled'}</span>
            </span>
          </div>
        </header>

        {banner && (
          <div className={`fnl-banner ${banner.kind}`} role="status">
            {banner.text}
          </div>
        )}

        <div className="fnl-edit-grid">
          <form action={updateCampaign} className="fnl-form-card wide">
            <input type="hidden" name="id" value={campaign.id} />
            <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
            <input type="hidden" name="personality_mode" value={personalityMode} />
            <input type="hidden" name="assignment_mode" value={assignmentMode} />

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
                  defaultValue={campaign.name}
                />
              </div>
              <div className="fnl-field">
                <label htmlFor={`${fid}-status`}>Status</label>
                <select
                  id={`${fid}-status`}
                  name="status"
                  defaultValue={campaign.status}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div className="fnl-field">
              <label htmlFor={`${fid}-description`}>Description</label>
              <textarea
                id={`${fid}-description`}
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={campaign.description ?? ''}
              />
            </div>

            <fieldset className="fnl-fieldset">
              <legend>Enabled</legend>
              <p className="fnl-hint">
                Disabling a campaign removes it from rotation immediately.
                Existing leads mid-funnel keep their state.
              </p>
              <button
                type="button"
                className={`fnl-toggle${enabled ? ' on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
                aria-pressed={enabled}
              >
                <span className="fnl-toggle-knob" />
                <span className="fnl-toggle-label">{enabled ? 'On' : 'Off'}</span>
              </button>
            </fieldset>

            <fieldset className="fnl-fieldset">
              <legend>Personality</legend>
              <div className="fnl-segments" role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={personalityMode === 'chatbot'}
                  className={`fnl-segment${personalityMode === 'chatbot' ? ' active' : ''}`}
                  onClick={() => setPersonalityMode('chatbot')}
                >
                  Use chatbot personality
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={personalityMode === 'custom'}
                  className={`fnl-segment${personalityMode === 'custom' ? ' active' : ''}`}
                  onClick={() => setPersonalityMode('custom')}
                >
                  Custom for this campaign
                </button>
              </div>
              {personalityMode === 'custom' && (
                <div className="fnl-personality-block">
                  <div className="fnl-field">
                    <label htmlFor={`${fid}-persona`}>Persona</label>
                    <textarea
                      id={`${fid}-persona`}
                      name="persona"
                      rows={4}
                      maxLength={4000}
                      placeholder="e.g. Alex Hormozi-style, blunt, value-first, taglish."
                      defaultValue={campaign.persona}
                    />
                  </div>
                  <div className="fnl-form-row">
                    <div className="fnl-field">
                      <label htmlFor={`${fid}-do`}>DO rules (one per line)</label>
                      <textarea
                        id={`${fid}-do`}
                        name="do_rules"
                        rows={4}
                        placeholder="Lead with the outcome. Use proof points."
                        defaultValue={campaign.do_rules.join('\n')}
                      />
                    </div>
                    <div className="fnl-field">
                      <label htmlFor={`${fid}-dont`}>DON&apos;T rules (one per line)</label>
                      <textarea
                        id={`${fid}-dont`}
                        name="dont_rules"
                        rows={4}
                        placeholder="Don't drop the price before qualifying."
                        defaultValue={campaign.dont_rules.join('\n')}
                      />
                    </div>
                  </div>
                </div>
              )}
              {personalityMode === 'chatbot' && (
                <>
                  <input type="hidden" name="persona" value={campaign.persona} />
                  <input
                    type="hidden"
                    name="do_rules"
                    value={campaign.do_rules.join('\n')}
                  />
                  <input
                    type="hidden"
                    name="dont_rules"
                    value={campaign.dont_rules.join('\n')}
                  />
                </>
              )}
            </fieldset>

            <fieldset className="fnl-fieldset">
              <legend>Assignment</legend>
              <div className="fnl-segments" role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={assignmentMode === 'manual'}
                  className={`fnl-segment${assignmentMode === 'manual' ? ' active' : ''}`}
                  onClick={() => setAssignmentMode('manual')}
                >
                  Manual
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={assignmentMode === 'random'}
                  className={`fnl-segment${assignmentMode === 'random' ? ' active' : ''}`}
                  onClick={() => setAssignmentMode('random')}
                >
                  Random (A/B)
                </button>
              </div>
              {assignmentMode === 'random' && (
                <div className="fnl-field tight">
                  <label htmlFor={`${fid}-weight`}>Weight (0–100)</label>
                  <input
                    id={`${fid}-weight`}
                    name="weight"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={campaign.weight}
                  />
                  <p className="fnl-hint">
                    Higher = more leads. Set to 0 to keep enabled but pause new
                    assignments.
                  </p>
                </div>
              )}
              {assignmentMode === 'manual' && (
                <input type="hidden" name="weight" value={campaign.weight} />
              )}
            </fieldset>

            <fieldset className="fnl-fieldset">
              <legend>Goal action page</legend>
              <p className="fnl-hint">
                The terminal page used as the campaign-level conversion event.
                Funnels can still each terminate at their own action page; this
                is the one that closes the loop.
              </p>
              <div className="fnl-field">
                <select
                  name="goal_action_page_id"
                  defaultValue={campaign.goal_action_page_id ?? ''}
                >
                  <option value="">— No goal page —</option>
                  {goalOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.kind})
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            <div className="fnl-form-foot">
              <DeleteCampaignButton id={campaign.id} />
              <button type="submit" className="fn-btn fn-btn-primary">
                Save campaign
              </button>
            </div>
          </form>

          <aside className="fnl-funnels-aside">
            <div className="fnl-aside-head">
              <div>
                <h2>Funnels</h2>
                <p>Ordered nodes leads progress through inside this campaign.</p>
              </div>
              <form action={createFunnel}>
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <input type="hidden" name="name" value="Untitled funnel" />
                <button type="submit" className="fn-btn fn-btn-secondary">
                  + Add funnel
                </button>
              </form>
            </div>

            {funnels.length === 0 ? (
              <div className="fnl-aside-empty">
                No funnels yet. Add one to start scripting the flow.
              </div>
            ) : (
              <ol className="fnl-funnels-list">
                {funnels.map((f, i) => {
                  const goal = f.action_page_id
                    ? actionPages.find((p) => p.id === f.action_page_id)
                    : null
                  return (
                    <li key={f.id} className="fnl-funnel-row">
                      <Link
                        href={`/dashboard/funnels/${campaign.id}/funnels/${f.id}`}
                        className="fnl-funnel-link"
                      >
                        <span className="fnl-funnel-idx">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="fnl-funnel-meta">
                          <b>{f.name}</b>
                          <span>
                            {f.requirements.length} requirement
                            {f.requirements.length === 1 ? '' : 's'} ·{' '}
                            {f.rules.length} rule
                            {f.rules.length === 1 ? '' : 's'} ·{' '}
                            {goal ? `→ ${goal.title}` : 'no action page'}
                          </span>
                        </div>
                      </Link>
                      <form action={deleteFunnel}>
                        <input type="hidden" name="id" value={f.id} />
                        <input
                          type="hidden"
                          name="campaign_id"
                          value={campaign.id}
                        />
                        <button
                          type="submit"
                          className="fnl-icon-btn"
                          aria-label="Delete funnel"
                          title="Delete funnel"
                          onClick={(e) => {
                            if (
                              !window.confirm(
                                `Delete funnel "${f.name}"? This cannot be undone.`,
                              )
                            )
                              e.preventDefault()
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </form>
                    </li>
                  )
                })}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function DeleteCampaignButton({ id: _id }: { id: string }) {
  return (
    <button
      type="submit"
      formAction={deleteCampaign}
      formNoValidate
      className="fn-btn fn-btn-danger"
      onClick={(e) => {
        if (
          !window.confirm(
            'Delete this campaign and every funnel inside? This cannot be undone.',
          )
        )
          e.preventDefault()
      }}
    >
      Delete campaign
    </button>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
