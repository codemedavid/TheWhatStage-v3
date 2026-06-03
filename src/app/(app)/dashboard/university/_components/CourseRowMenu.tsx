'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { CourseStatus } from '@/lib/university/types'
import { setCourseStatusAction } from '../actions'
import { DeleteCourseModal } from './DeleteCourseModal'

type Props = {
  courseId: string
  slug: string
  title: string
  status: CourseStatus
  lessonCount: number
}

export function CourseRowMenu({ courseId, slug, title, status, lessonCount }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside-click + Escape.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function changeStatus(next: CourseStatus) {
    setError(null)
    startTransition(async () => {
      const res = await setCourseStatusAction(courseId, next)
      if (!res.ok) {
        setError(res.error ?? 'Update failed.')
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  const canPublish = lessonCount > 0
  // Superadmins can view drafts/archived directly (RLS grants them read access),
  // so the preview link is the same public URL regardless of status.
  const previewHref = `/university/${slug}`

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${title}`}
        onClick={() => { setError(null); setOpen((v) => !v) }}
        disabled={pending}
        className="uni-row-trigger"
      >
        {pending ? '…' : <DotsIcon />}
      </button>

      {open && (
        <div role="menu" className="uni-row-menu">
          <MenuLink href={`/dashboard/university/${courseId}/edit`} onSelect={() => setOpen(false)}>
            <PencilIcon /> Edit
          </MenuLink>
          <MenuLink href={previewHref} target="_blank" onSelect={() => setOpen(false)}>
            <EyeIcon /> Preview
          </MenuLink>

          <div className="uni-menu-sep" role="separator" />

          {status === 'published' ? (
            <MenuButton onSelect={() => changeStatus('draft')} disabled={pending}>
              <EyeOffIcon /> Unpublish
            </MenuButton>
          ) : (
            <MenuButton
              onSelect={() => changeStatus('published')}
              disabled={pending || !canPublish}
              title={canPublish ? undefined : 'Add at least one playable lesson before publishing.'}
            >
              <UpIcon /> Publish
            </MenuButton>
          )}

          {status !== 'archived' && (
            <MenuButton onSelect={() => changeStatus('archived')} disabled={pending}>
              <ArchiveIcon /> Archive
            </MenuButton>
          )}
          {status === 'archived' && (
            <MenuButton onSelect={() => changeStatus('draft')} disabled={pending}>
              <RestoreIcon /> Restore to draft
            </MenuButton>
          )}

          <div className="uni-menu-sep" role="separator" />

          <MenuButton
            danger
            onSelect={() => { setOpen(false); setShowDelete(true) }}
            disabled={pending}
          >
            <TrashIcon /> Delete…
          </MenuButton>

          {!canPublish && status !== 'published' && (
            <div className="uni-menu-note">Add at least one playable lesson before publishing.</div>
          )}
          {error && <div className="uni-menu-error">{error}</div>}
        </div>
      )}

      {showDelete && (
        <DeleteCourseModal
          courseId={courseId}
          slug={slug}
          title={title}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false)
            router.refresh()
          }}
        />
      )}

      <style>{`
        .uni-row-trigger {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 8px;
          border: 1px solid transparent; background: transparent;
          color: var(--ws-ink-3); cursor: pointer; transition: background 120ms, border-color 120ms;
        }
        .uni-row-trigger:hover:not(:disabled) { background: var(--ws-surface-2); border-color: var(--ws-border); color: var(--ws-ink); }
        .uni-row-trigger:disabled { cursor: default; opacity: 0.6; }
        .uni-row-menu {
          position: absolute; top: 34px; right: 0; z-index: 40;
          min-width: 196px; padding: 6px;
          background: var(--ws-surface); border: 1px solid var(--ws-border);
          border-radius: 12px; box-shadow: 0 18px 48px -12px rgba(23,21,16,0.18);
        }
        .uni-menu-item {
          display: flex; align-items: center; gap: 9px; width: 100%;
          padding: 8px 10px; border-radius: 8px; border: none; background: transparent;
          font-size: 13px; font-weight: 500; color: var(--ws-ink-2);
          text-align: left; text-decoration: none; cursor: pointer; transition: background 100ms;
        }
        .uni-menu-item:hover:not(:disabled) { background: var(--ws-surface-2); color: var(--ws-ink); }
        .uni-menu-item:disabled { color: var(--ws-ink-4); cursor: not-allowed; }
        .uni-menu-item.danger { color: var(--ws-warn, #B23A2B); }
        .uni-menu-item.danger:hover:not(:disabled) { background: var(--ws-warn-soft, #FBEBE7); }
        .uni-menu-item svg { flex-shrink: 0; }
        .uni-menu-sep { height: 1px; margin: 5px 4px; background: var(--ws-border); }
        .uni-menu-note { padding: 6px 10px 4px; font-size: 11.5px; color: var(--ws-ink-4); line-height: 1.4; }
        .uni-menu-error { padding: 6px 10px 4px; font-size: 11.5px; color: #B23A2B; line-height: 1.4; }
      `}</style>
    </div>
  )
}

function MenuLink({
  href,
  target,
  onSelect,
  children,
}: {
  href: string
  target?: string
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      role="menuitem"
      className="uni-menu-item"
      onClick={onSelect}
    >
      {children}
    </a>
  )
}

function MenuButton({
  onSelect,
  disabled,
  danger,
  title,
  children,
}: {
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`uni-menu-item${danger ? ' danger' : ''}`}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}

/* ── icons (1.75 stroke, hand-drawn) ── */
const svgProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function DotsIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.5z" />
      <path d="M14 7l3 3" />
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg {...svgProps}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  )
}
function EyeOffIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 5.5C18.5 5.5 22 12 22 12a17 17 0 0 1-3.2 4M6.3 7.9A17 17 0 0 0 2 12s3.5 6.5 10 6.5a9.5 9.5 0 0 0 3.6-.7" />
      <path d="M9.5 9.7a2.8 2.8 0 0 0 4 3.9" />
    </svg>
  )
}
function UpIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}
function ArchiveIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  )
}
function RestoreIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
