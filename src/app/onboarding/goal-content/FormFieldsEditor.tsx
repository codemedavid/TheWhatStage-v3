'use client'

import { useActionState, useState } from 'react'
import { saveFormFieldsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface BlockLite { id: string; label?: string; prompt?: string }

export function FormFieldsEditor({
  lang, pageId, initialBlocks, kind,
}: {
  lang: OnboardingLang; pageId: string; initialBlocks: BlockLite[]; kind: 'form' | 'qualification'
}) {
  const [blocks, setBlocks] = useState<BlockLite[]>(initialBlocks)
  const [state, action, pending] = useActionState(saveFormFieldsAction, {})

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="blocks_json" value={JSON.stringify(blocks)} />

      <ul className="space-y-2">
        {blocks.map((b, i) => (
          <li key={b.id}>
            <input
              type="text"
              value={(kind === 'qualification' ? b.prompt : b.label) ?? ''}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((it, j) =>
                    j === i
                      ? kind === 'qualification'
                        ? { ...it, prompt: e.target.value }
                        : { ...it, label: e.target.value }
                      : it,
                  ),
                )
              }
              maxLength={300}
              className="ob-input"
              placeholder={t('gc.form.label_ph', lang)}
            />
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="ob-btn ob-btn-primary">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
