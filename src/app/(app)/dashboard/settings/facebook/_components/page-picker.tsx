'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FacebookPage } from '@/lib/facebook/oauth'
import { savePagesForm, disconnectForm } from '../actions'
import { PageAvatar } from './page-avatar'

export function PagePicker({ pages }: { pages: FacebookPage[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (pages.length === 0) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-[16px] font-semibold text-[#111827] mb-2">
          No pages found
        </h2>
        <p className="text-[13px] text-[#6B7280] mb-4">
          Your Facebook account doesn&apos;t manage any pages.
        </p>
        <form
          action={() =>
            startTransition(async () => {
              await disconnectForm()
              router.refresh()
            })
          }
        >
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-60"
          >
            {pending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await savePagesForm(formData)
          router.refresh()
        })
      }
      className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
        Pick pages to track
      </h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Select one or more pages to connect.
      </p>
      <ul className="mb-4 divide-y divide-[#F3F4F6] rounded-lg border border-[#E5E7EB]">
        {pages.map((p) => (
          <li key={p.id}>
            <label
              htmlFor={`pg-${p.id}`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[#F9FAFB]"
            >
              <input
                type="checkbox"
                name="page_id"
                value={p.id}
                id={`pg-${p.id}`}
                className="h-4 w-4 shrink-0 rounded border-[#D1D5DB] text-[#059669] focus:ring-[#059669]"
              />
              <PageAvatar src={p.pictureUrl} name={p.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-[#111827]">
                  {p.name}
                </div>
                {p.category && (
                  <div className="truncate text-[12px] text-[#6B7280]">
                    {p.category}
                  </div>
                )}
              </div>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-md bg-[#059669] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#047857] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save pages'}
        </button>
        <Link
          href="/api/auth/facebook/start"
          className="text-[13px] font-medium text-[#1877F2] hover:underline"
        >
          Don&apos;t see a page you added? Reconnect to grant access
        </Link>
      </div>
    </form>
  )
}
