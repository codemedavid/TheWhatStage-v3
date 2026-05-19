'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { AccountStatus } from '@/lib/auth/account-status'

type Props = {
  userId: string
  status: AccountStatus
}

const buttonByStatus: Record<AccountStatus, {
  label: string
  next: 'active' | 'paused'
  confirm: string
  tone: 'primary' | 'danger' | 'neutral'
} | null> = {
  pending: {
    label: 'Approve',
    next: 'active',
    confirm: 'Approve this user? They will be able to sign in and the bot will reply to their Messenger page.',
    tone: 'primary',
  },
  active: {
    label: 'Pause',
    next: 'paused',
    confirm: 'Pause this user? They will be signed out and their Messenger bot will stop replying.',
    tone: 'danger',
  },
  paused: {
    label: 'Resume',
    next: 'active',
    confirm: 'Resume this user? They will be able to sign in again and the bot will reply.',
    tone: 'primary',
  },
}

const toneClass: Record<'primary' | 'danger' | 'neutral', string> = {
  primary: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  danger: 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
  neutral: 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
}

export function UserRowActions({ userId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const action = buttonByStatus[status]
  if (!action) return null

  const onClick = () => {
    if (typeof window !== 'undefined' && !window.confirm(action.confirm)) return
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/superadmin/users/${userId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: action.next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Failed to update status.')
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass[action.tone]}`}
      >
        {pending ? '…' : action.label}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  )
}
