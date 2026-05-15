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
          <li key={b.id} className="rounded-md border border-zinc-200 bg-white p-3">
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
              className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none"
              placeholder={t('gc.form.label_ph', lang)}
            />
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
