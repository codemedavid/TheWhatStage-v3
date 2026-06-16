'use client'

import { useState, useTransition } from 'react'
import type { ChatbotConfig } from '@/lib/chatbot/config'
import type { MediaAssetRow, MediaFolderRow } from '@/app/(app)/dashboard/media/_lib/queries'
import { saveChatbotConfig } from '../actions'
import { RuleList } from './RuleList'
import { MentionTextarea } from './MentionTextarea'

type Tab = 'personality' | 'instructions'

export interface ActionPageMentionItem {
  id: string
  slug: string
  title: string
  ctaLabel: string
}

export function ConfigForm({
  initial,
  mediaFolders,
  mediaAssets,
  actionPages,
}: {
  initial: ChatbotConfig
  mediaFolders: MediaFolderRow[]
  mediaAssets: MediaAssetRow[]
  actionPages: ActionPageMentionItem[]
}) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [persona, setPersona] = useState(initial.persona)
  const [tab, setTab] = useState<Tab>('instructions')

  function onSubmit(formData: FormData) {
    setSaved(false)
    startTransition(async () => {
      await saveChatbotConfig(formData)
      setSaved(true)
      setDirty(false)
    })
  }

  const wordCount = persona.trim().split(/\s+/).filter(Boolean).length

  return (
    <form
      action={onSubmit}
      onChange={() => setDirty(true)}
      className="cb-form"
    >
      {/* Identity */}
      <div className="cb-section">
        <div className="cb-section-head">
          <h2>Identity</h2>
          <p>How your assistant introduces itself.</p>
        </div>
        <div className="cb-section-body">
          <div className="cb-field">
            <label className="cb-field-label" htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              defaultValue={initial.name}
              className="cb-input"
              placeholder="Assistant"
            />
            <div className="cb-field-help">Shown in the chat header.</div>
          </div>
        </div>
      </div>

      {/* Tabbed: Personality & Rules / Instructions */}
      <div className="cb-section">
        <div className="cb-tabs">
          <button
            type="button"
            className={`cb-tab${tab === 'personality' ? ' active' : ''}`}
            onClick={() => setTab('personality')}
          >
            Personality &amp; Rules
          </button>
          <button
            type="button"
            className={`cb-tab${tab === 'instructions' ? ' active' : ''}`}
            onClick={() => setTab('instructions')}
          >
            Instructions
          </button>
        </div>

        <div style={{ display: tab === 'personality' ? 'block' : 'none' }}>
            {/* Personality */}
            <div className="cb-section-head">
              <h2>Personality</h2>
              <p>Describe identity and voice. The system prompt prepends this with structure.</p>
            </div>
            <div className="cb-section-body">
              <div className="cb-field">
                <textarea
                  id="persona"
                  name="persona"
                  rows={6}
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  className="cb-textarea cb-textarea-tall"
                  placeholder="One paragraph: who is this assistant, what tone, what business?"
                />
                <div className="cb-field-help">{wordCount} words</div>
              </div>
            </div>

            {/* Rules */}
            <div className="cb-section-head" style={{ marginTop: 4 }}>
              <h2>
                Rules
                <span className="cb-head-tag">
                  {(initial.doRules?.length ?? 0) + (initial.dontRules?.length ?? 0)}
                </span>
              </h2>
              <p>Hard constraints that override personality.</p>
            </div>
            <div className="cb-section-body">
              <div className="cb-rule-cols">
                <div className="cb-rule-col do">
                  <div className="cb-rule-col-head">
                    <div className="cb-rule-col-icon" aria-hidden>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div>
                      <h3>DO</h3>
                      <p>Things the assistant should always do</p>
                    </div>
                  </div>
                  <RuleList
                    name="doRules"
                    initial={initial.doRules}
                    placeholder="e.g. Mirror the user's language."
                    addLabel="Add DO rule"
                  />
                </div>

                <div className="cb-rule-col dont">
                  <div className="cb-rule-col-head">
                    <div className="cb-rule-col-icon" aria-hidden>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </div>
                    <div>
                      <h3>DON&apos;T</h3>
                      <p>Things the assistant must never do</p>
                    </div>
                  </div>
                  <RuleList
                    name="dontRules"
                    initial={initial.dontRules}
                    placeholder="e.g. Never invent prices or links."
                    addLabel="Add DON'T rule"
                  />
                </div>
              </div>
            </div>
        </div>

        <div style={{ display: tab === 'instructions' ? 'block' : 'none' }}>
            <div className="cb-section-head">
              <h2>Instructions</h2>
              <p>
                Tell the bot what to focus on and how to handle specific situations.
                This is injected at the top of every prompt, above personality and rules.
              </p>
            </div>
            <div className="cb-section-body">
              <div className="cb-field">
                <MentionTextarea
                  id="instructions"
                  name="instructions"
                  rows={10}
                  defaultValue={initial.instructions}
                  className="cb-textarea cb-textarea-instructions"
                  placeholder={
                    'Examples:\n' +
                    '• When someone asks about pricing, always lead with the value before the number.\n' +
                    '• Type @ to attach an image, # to reference a folder, ! to send an action page.\n' +
                    '• Always ask for the customer\'s name if it hasn\'t been shared yet.'
                  }
                  assets={mediaAssets}
                  folders={mediaFolders}
                  actionPages={actionPages}
                />
                <div className="cb-field-help">
                  Free-form directives. Use <code>@image-slug</code> to attach a specific image, <code>#folder-slug</code> to pick from a folder, and <code>!actionpage:slug</code> to send an action page when the instructions say to.
                </div>
              </div>
            </div>

            <div className="cb-section-head">
              <h2>Pause AI rules</h2>
              <p>
                Describe when the bot should stop replying and hand the conversation
                to a human. When a message clearly matches one of these, the bot sends
                a short handoff reply and pauses itself for your human-takeover window.
              </p>
            </div>
            <div className="cb-section-body">
              <div className="cb-field">
                <textarea
                  id="pauseAiInstructions"
                  name="pauseAiInstructions"
                  rows={6}
                  maxLength={2000}
                  defaultValue={initial.pauseAiInstructions ?? ''}
                  className="cb-textarea"
                  placeholder={
                    'Examples:\n' +
                    '• Pause if the customer explicitly asks to talk to a person or a manager.\n' +
                    '• Pause if the customer is clearly angry or threatening to leave.\n' +
                    '• Pause for refund or complaint requests above 5,000.'
                  }
                />
                <div className="cb-field-help">
                  Leave blank to keep the bot replying on every turn. One rule per line works best.
                </div>
              </div>
            </div>
        </div>
      </div>

      {/* Knowledge & behavior */}
      <div className="cb-section">
        <div className="cb-section-head">
          <h2>Knowledge &amp; behavior</h2>
          <p>What the assistant draws from and how it responds.</p>
        </div>
        <div className="cb-section-body">
          <div className="cb-field">
            <label className="cb-field-label" htmlFor="fallbackMessage">Fallback message</label>
            <input
              id="fallbackMessage"
              name="fallbackMessage"
              defaultValue={initial.fallbackMessage}
              className="cb-input"
            />
            <div className="cb-field-help">Used verbatim when the knowledge base does not contain the answer.</div>
          </div>

          <div className="cb-field-row">
            <div className="cb-field">
              <label className="cb-field-label" htmlFor="temperature">Temperature</label>
              <input
                id="temperature"
                name="temperature"
                type="number"
                min={0}
                max={1}
                step={0.05}
                defaultValue={initial.temperature}
                className="cb-input cb-input-mono"
              />
              <div className="cb-field-help">0 = strict, 1 = creative.</div>
            </div>
            <div className="cb-field">
              <label className="cb-field-label" htmlFor="maxContext">Max context chunks</label>
              <input
                id="maxContext"
                name="maxContext"
                type="number"
                min={1}
                max={40}
                step={1}
                defaultValue={initial.maxContext}
                className="cb-input cb-input-mono"
              />
              <div className="cb-field-help">Knowledge passages per reply.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="cb-save-bar">
        <div className="cb-save-bar-meta">
          {pending ? (
            <>Saving…</>
          ) : dirty ? (
            <><b>Unsaved changes</b> · Configuration</>
          ) : saved ? (
            <>Saved · Configuration</>
          ) : (
            <>Configuration</>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="cb-btn cb-btn-primary"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
