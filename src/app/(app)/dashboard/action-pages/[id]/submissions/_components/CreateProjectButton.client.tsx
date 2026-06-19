'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createProjectFromSubmission } from '../../../../projects/actions/projects'
import type { SubmissionProjectInfo } from '../../../_lib/queries'
import { UnreadBadge } from '../../../../_components/UnreadBadge'

interface Props {
  submissionId: string
  leadId: string | null
  existingProject?: SubmissionProjectInfo | null
}

// Color palette for the stage badge, keyed by stage kind. Won → green,
// lost → red, open (and unknown) → neutral slate.
const STAGE_BADGE_STYLES: Record<'open' | 'won' | 'lost', string> = {
  won: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D] hover:bg-[#DCFCE7]',
  lost: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2]',
  open: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#334155] hover:bg-[#F1F5F9]',
}

// Inline action on a submission card: turn the submission into a project so the
// deal can be tracked on the Projects board. Mirrors LeadProjectsPanel's
// useTransition + router.push pattern. Hidden when the submission has no lead,
// since createProjectFromSubmission requires one.
export function CreateProjectButton({ submissionId, leadId, existingProject }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (existingProject) {
    const badgeStyle = STAGE_BADGE_STYLES[existingProject.stageKind ?? 'open']
    const label = existingProject.stageName ?? 'Project'
    return (
      <span className="inline-flex items-center gap-1.5">
        <Link
          href={`/dashboard/projects?project=${existingProject.id}`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${badgeStyle}`}
          title={`Project stage: ${label}`}
        >
          <CheckIcon size={11} />
          {label}
        </Link>
        <UnreadBadge count={existingProject.unreadCount} title={`${existingProject.unreadCount} unread message(s) from this client`} />
        {existingProject.unreadCount === 0 && (
          <UnreadBadge count={existingProject.missedCount} variant="missed" title={`${existingProject.missedCount} missed message(s)`} />
        )}
      </span>
    )
  }

  if (!leadId) return null

  const create = () => {
    setError(null)
    start(async () => {
      try {
        const id = await createProjectFromSubmission(submissionId)
        router.push(`/dashboard/projects?project=${id}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create project')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] disabled:opacity-50"
      >
        <ProjectIcon size={11} />
        {pending ? 'Creating…' : 'Create project'}
      </button>
      {error && <span className="text-[10.5px] text-[#E11D48]">{error}</span>}
    </div>
  )
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function ProjectIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  )
}
