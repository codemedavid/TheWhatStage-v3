import type { EmbeddingStatus } from '../_lib/queries'

type Props = {
  status: EmbeddingStatus
  embeddedAt?: string | null
  hasUnsavedChanges?: boolean
  size?: 'sm' | 'md'
  jobStatus?: 'queued' | 'running' | 'done' | 'failed' | null
  jobError?: string | null
}

// "ready" means: chunks were committed for the latest version. We surface this
// as a green dot so users have one trustworthy answer to "is this in the bot?"
export function EmbeddingStatusBadge({
  status,
  embeddedAt,
  hasUnsavedChanges,
  size = 'sm',
  jobStatus,
  jobError,
}: Props) {
  const failed = jobStatus === 'failed'
  const indexing = jobStatus === 'queued' || jobStatus === 'running'

  let label: string
  let tone: 'green' | 'amber' | 'red' | 'gray'
  let dot: 'pulse' | 'static'

  if (failed) {
    label = 'Embedding failed'
    tone = 'red'
    dot = 'static'
  } else if (status === 'indexed' && !hasUnsavedChanges) {
    label = 'Ready'
    tone = 'green'
    dot = 'static'
  } else if (status === 'pending') {
    label = indexing ? 'Indexing…' : 'Not indexed yet'
    tone = indexing ? 'amber' : 'gray'
    dot = indexing ? 'pulse' : 'static'
  } else if (status === 'stale') {
    label = indexing ? 'Indexing…' : 'Queued for indexing'
    tone = 'amber'
    dot = 'pulse'
  } else {
    label = 'Indexing…'
    tone = 'amber'
    dot = 'pulse'
  }

  const palette = {
    green: { bg: 'bg-[rgba(5,150,105,0.08)]', text: 'text-[#059669]', dot: 'bg-[#059669]' },
    amber: { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', dot: 'bg-[#D97706]' },
    red: { bg: 'bg-[#FEE2E2]', text: 'text-[#B91C1C]', dot: 'bg-[#DC2626]' },
    gray: { bg: 'bg-[#F3F4F6]', text: 'text-[#6B7280]', dot: 'bg-[#9CA3AF]' },
  }[tone]

  const sizing =
    size === 'sm'
      ? 'gap-1 px-2 py-0.5 text-[10.5px]'
      : 'gap-1.5 px-2.5 py-1 text-[11.5px]'

  const title = failed && jobError
    ? `Embedding failed: ${jobError}`
    : status === 'indexed' && embeddedAt
    ? `Indexed ${new Date(embeddedAt).toLocaleString()}`
    : undefined

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full font-medium ${palette.bg} ${palette.text} ${sizing}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${palette.dot} ${dot === 'pulse' ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      {label}
    </span>
  )
}
