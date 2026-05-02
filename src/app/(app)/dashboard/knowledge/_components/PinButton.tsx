'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { togglePinDocument } from '../actions/tags'

export function PinButton({
  id,
  pinned,
  size = 'md',
}: {
  id: string
  pinned: boolean
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const px = size === 'sm' ? 12 : 14

  return (
    <button
      type="button"
      title={pinned ? 'Unpin' : 'Pin'}
      aria-label={pinned ? 'Unpin' : 'Pin'}
      aria-pressed={pinned}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        start(async () => {
          await togglePinDocument({ id, pinned: !pinned })
          router.refresh()
        })
      }}
      className={
        `inline-flex ${dim} items-center justify-center rounded-md transition-colors disabled:opacity-50 ` +
        (pinned
          ? 'text-amber-500 hover:bg-amber-50'
          : 'text-[#9aa0a6] hover:bg-[#f1f3f4] hover:text-[#3c4043]')
      }
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m12 2 3 7 7 .8-5.4 4.6 1.7 7L12 17.8 5.7 21.4l1.7-7L2 9.8 9 9z" />
      </svg>
    </button>
  )
}
