'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  saveCourseAction,
  createCategoryAction,
} from '@/app/(app)/dashboard/university/actions'
import type { AdminCourseDetail } from '@/lib/university/admin'
import { ACCESS_LEVELS, type AccessLevel } from '@/lib/university/types'
import { slugify, isValidSlug } from '@/lib/university/slug'
import { LessonList, makeEmptyLesson, type LessonDraftState } from './LessonList'

interface Props {
  mode: 'new' | 'edit'
  course?: AdminCourseDetail
  categories: { id: string; slug: string; name: string }[]
}

type CourseFields = {
  slug: string
  title: string
  subtitle: string
  description: string
  coverImageUrl: string
  categoryId: string | null
  accessLevel: AccessLevel
}

const ACCESS_LABELS: Record<AccessLevel, string> = {
  public: 'Public — anyone can watch',
  authenticated: 'Members — free, sign-in required',
  subscriber: 'Pro — subscription required',
}

function lessonsFromCourse(course?: AdminCourseDetail): LessonDraftState[] {
  if (!course || course.lessons.length === 0) {
    // New course (or empty edit): start with one empty expanded lesson.
    return [makeEmptyLesson()]
  }
  return course.lessons.map((l) => ({
    clientId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `db-${l.id}`,
    id: l.id,
    slug: l.slug,
    slugTouched: true,
    title: l.title,
    summary: l.summary ?? '',
    provider: l.provider,
    durationSeconds: l.durationSeconds,
    isPreview: l.isPreview,
    providerInput: l.providerInput,
  }))
}

export function CourseEditor({ mode, course, categories: initialCategories }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [courseId, setCourseId] = useState<string | null>(course?.id ?? null)
  const [fields, setFields] = useState<CourseFields>({
    slug: course?.slug ?? '',
    title: course?.title ?? '',
    subtitle: course?.subtitle ?? '',
    description: course?.description ?? '',
    coverImageUrl: course?.coverImageUrl ?? '',
    categoryId: course?.categoryId ?? null,
    accessLevel: course?.accessLevel ?? 'authenticated',
  })
  const [slugTouched, setSlugTouched] = useState(mode === 'edit')
  const [lessons, setLessons] = useState<LessonDraftState[]>(() => lessonsFromCourse(course))
  const [categories, setCategories] = useState(initialCategories)

  const [dirty, setDirty] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // ── dirty tracking: warn before leaving with unsaved changes ──
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const markDirty = () => {
    if (!dirty) setDirty(true)
    if (saved) setSaved(false)
  }

  const setField = <K extends keyof CourseFields>(key: K, value: CourseFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }))
    markDirty()
  }

  const onTitle = (value: string) => {
    setFields((prev) => ({
      ...prev,
      title: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }))
    markDirty()
  }

  const onSlug = (value: string) => {
    setSlugTouched(true)
    setField('slug', value.toLowerCase())
  }

  const regenSlug = () => {
    setSlugTouched(false)
    setField('slug', slugify(fields.title))
  }

  const onLessonsChange = (next: LessonDraftState[]) => {
    setLessons(next)
    markDirty()
  }

  const slugIsValid = fields.slug.length === 0 || isValidSlug(fields.slug)

  // A gated course with no preview lesson can't be previewed by guests.
  const gatedNoPreview =
    fields.accessLevel !== 'public' && !lessons.some((l) => l.isPreview)

  const handleSave = () => {
    setFormError(null)
    setFieldErrors({})

    // Client-side guards mirroring the server zod schema (fail fast, friendlier).
    const errs: Record<string, string> = {}
    if (!fields.title.trim()) errs['course.title'] = 'Add a course title.'
    if (!isValidSlug(fields.slug)) errs['course.slug'] = 'Slug must be lowercase letters, numbers and dashes (2–80 chars).'
    lessons.forEach((l) => {
      if (!l.title.trim()) errs['lessons'] = 'Every lesson needs a title.'
      if (!isValidSlug(l.slug)) errs['lessons'] = `Lesson "${l.title || 'untitled'}" needs a valid slug.`
      if (!l.providerInput.trim()) errs['lessons'] = `Lesson "${l.title || 'untitled'}" needs a video.`
    })
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      setFormError('Please fix the highlighted fields.')
      return
    }

    const input = {
      courseId,
      course: {
        slug: fields.slug,
        title: fields.title.trim(),
        subtitle: fields.subtitle.trim() || null,
        description: fields.description.trim() || null,
        coverImageUrl: fields.coverImageUrl.trim() || null,
        categoryId: fields.categoryId,
        accessLevel: fields.accessLevel,
      },
      lessons: lessons.map((l) => ({
        id: l.id,
        slug: l.slug,
        title: l.title.trim(),
        summary: l.summary.trim() || null,
        provider: l.provider,
        durationSeconds: l.durationSeconds,
        isPreview: l.isPreview,
        providerInput: l.providerInput.trim(),
      })),
    }

    startTransition(async () => {
      const result = await saveCourseAction(input)
      if (result.ok) {
        setDirty(false)
        setSaved(true)
        if (mode === 'new' && courseId === null) {
          // New course created → go to its edit route (clears beforeunload via setDirty(false)).
          setCourseId(result.courseId)
          router.push(`/dashboard/university/${result.courseId}/edit`)
          router.refresh()
        } else {
          router.refresh()
        }
      } else {
        setFormError(result.error)
        if (result.field) {
          // Map server field paths ("slug", "course.slug", "lessons") to our keys.
          const key = result.field === 'slug' ? 'course.slug' : result.field
          setFieldErrors({ [key]: result.error })
        }
      }
    })
  }

  const statusLabel = mode === 'new' ? 'Draft' : 'Draft'

  const headTitle = fields.title.trim() || 'Untitled course'

  return (
    <div data-university-admin>
      <div data-actions-root>
        <div className="ap-page">
          {/* Topbar: back + breadcrumbs + status segment */}
          <div className="ap-topbar">
            <Link href="/dashboard/university" className="ap-back">
              <Chevron dir="left" /> Back
            </Link>
            <div className="ap-crumbs">
              <Link href="/dashboard/university">University</Link>
              <Chevron dir="right" size={12} />
              <span className="ap-crumb-current">{mode === 'new' ? 'New course' : headTitle}</span>
            </div>
            <div className="ap-spacer" />
            <span className="ap-status-pill">
              <span className="ap-status-dot" />
              {statusLabel}
            </span>
          </div>

          <div className="ap-head">
            <div className="ap-head-meta">
              <h1>{headTitle}</h1>
              <p className="ap-sub">
                {mode === 'new'
                  ? 'Create a course, then add lessons. New courses stay Draft until you publish from the list.'
                  : 'Edit course details and lessons. Publish or unpublish from the course list.'}
              </p>
            </div>
          </div>

          {saved && <div className="ap-banner success">Saved.</div>}
          {formError && <div className="ap-banner error">{formError}</div>}

          <div className="ap-content">
            <div className="ap-editor">
              {/* ── Course details ── */}
              <div className="ap-section">
                <div className="ap-section-head">
                  <h2>Course details</h2>
                  <p>Shown on the catalog card and the course page.</p>
                </div>
                <div className="ap-section-body">
                  <Field label="Title" error={fieldErrors['course.title']}>
                    <input
                      className="ap-input"
                      type="text"
                      maxLength={160}
                      value={fields.title}
                      placeholder="e.g. The Messenger Growth Playbook"
                      onChange={(e) => onTitle(e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Slug"
                    error={fieldErrors['course.slug']}
                    help={!slugIsValid ? undefined : 'The public URL for this course.'}
                  >
                    <div className="ap-input-affix">
                      <span className="ap-prefix">/university/</span>
                      <input
                        type="text"
                        maxLength={80}
                        value={fields.slug}
                        placeholder="messenger-growth"
                        onChange={(e) => onSlug(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={regenSlug}
                        title="Regenerate from title"
                        aria-label="Regenerate slug from title"
                        style={{
                          border: 'none',
                          borderLeft: '1px solid var(--ws-border)',
                          background: 'var(--ws-surface-2)',
                          color: 'var(--ws-ink-3)',
                          padding: '0 12px',
                          cursor: 'pointer',
                          fontSize: 14,
                        }}
                      >
                        🔄
                      </button>
                    </div>
                  </Field>

                  <Field label="Subtitle" optional>
                    <input
                      className="ap-input"
                      type="text"
                      maxLength={280}
                      value={fields.subtitle}
                      placeholder="One line that sells the course."
                      onChange={(e) => setField('subtitle', e.target.value)}
                    />
                  </Field>

                  <Field label="Description" optional>
                    <textarea
                      className="ap-textarea"
                      rows={5}
                      maxLength={8000}
                      value={fields.description}
                      placeholder="What this course covers and who it's for."
                      onChange={(e) => setField('description', e.target.value)}
                    />
                  </Field>

                  <Field label="Cover image URL" optional help="An ImageKit (or other https) image URL.">
                    <input
                      className="ap-input"
                      type="text"
                      maxLength={1000}
                      value={fields.coverImageUrl}
                      placeholder="https://ik.imagekit.io/…/cover.jpg"
                      onChange={(e) => setField('coverImageUrl', e.target.value)}
                    />
                    {fields.coverImageUrl.trim() && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={fields.coverImageUrl}
                        alt=""
                        style={{
                          marginTop: 8,
                          width: 96,
                          height: 60,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--ws-border)',
                          background: 'var(--ws-surface-2)',
                        }}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    )}
                  </Field>

                  <div className="ap-field-row">
                    <CategoryField
                      categories={categories}
                      value={fields.categoryId}
                      onChange={(id) => setField('categoryId', id)}
                      onCreated={(cat) => {
                        setCategories((prev) => [...prev, cat])
                        setField('categoryId', cat.id)
                      }}
                    />

                    <Field label="Access level">
                      <select
                        className="ap-select"
                        value={fields.accessLevel}
                        onChange={(e) => setField('accessLevel', e.target.value as AccessLevel)}
                      >
                        {ACCESS_LEVELS.map((a) => (
                          <option key={a} value={a}>
                            {ACCESS_LABELS[a]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {gatedNoPreview && (
                    <p
                      className="ap-field-help"
                      style={{ marginTop: 8, color: 'var(--ws-warn)' }}
                    >
                      This course is gated. Mark a lesson as a Free preview below so guests can sample it.
                    </p>
                  )}
                </div>
              </div>

              {/* ── Lessons ── */}
              <div className="ap-section">
                <div className="ap-section-head">
                  <h2>Lessons</h2>
                  <p>Drag the ⠿ handle to reorder. Each lesson needs a valid video.</p>
                </div>
                <div className="ap-section-body">
                  <LessonList lessons={lessons} onChange={onLessonsChange} />
                  {fieldErrors['lessons'] && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--ws-warn)', fontSize: 12.5, marginTop: 8 }}>
                      {fieldErrors['lessons']}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Sticky save bar ── */}
              <div className="ap-save-bar">
                <div className="ap-save-meta">
                  {isPending ? (
                    <b>Saving…</b>
                  ) : dirty ? (
                    <b style={{ color: 'var(--ws-warn)' }}>● Unsaved changes</b>
                  ) : (
                    <b style={{ color: 'var(--ws-ink-3)' }}>All changes saved</b>
                  )}
                </div>
                <button
                  type="button"
                  className="ap-btn ap-btn-ghost"
                  disabled={isPending || !dirty}
                  onClick={() => {
                    // Discard → reset to the server snapshot.
                    setFields({
                      slug: course?.slug ?? '',
                      title: course?.title ?? '',
                      subtitle: course?.subtitle ?? '',
                      description: course?.description ?? '',
                      coverImageUrl: course?.coverImageUrl ?? '',
                      categoryId: course?.categoryId ?? null,
                      accessLevel: course?.accessLevel ?? 'authenticated',
                    })
                    setLessons(lessonsFromCourse(course))
                    setSlugTouched(mode === 'edit')
                    setFieldErrors({})
                    setFormError(null)
                    setDirty(false)
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="ap-btn ap-btn-primary"
                  disabled={isPending}
                  onClick={handleSave}
                >
                  {isPending ? 'Saving…' : mode === 'new' ? 'Create course' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inline category select + "new category" creator ──
function CategoryField({
  categories,
  value,
  onChange,
  onCreated,
}: {
  categories: { id: string; slug: string; name: string }[]
  value: string | null
  onChange: (id: string | null) => void
  onCreated: (cat: { id: string; slug: string; name: string }) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const create = () => {
    setError(null)
    startTransition(async () => {
      const result = await createCategoryAction(name)
      if (result.ok) {
        onCreated(result.category)
        setName('')
        setCreating(false)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Field label="Category" optional>
      {creating ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={inputRef}
            className="ap-input"
            type="text"
            maxLength={80}
            value={name}
            placeholder="New category name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              } else if (e.key === 'Escape') {
                setCreating(false)
                setName('')
                setError(null)
              }
            }}
          />
          <button
            type="button"
            className="ap-btn ap-btn-primary ap-btn-sm"
            disabled={isPending || name.trim().length === 0}
            onClick={create}
          >
            {isPending ? '…' : 'Add'}
          </button>
          <button
            type="button"
            className="ap-btn ap-btn-ghost ap-btn-sm"
            onClick={() => {
              setCreating(false)
              setName('')
              setError(null)
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <select
          className="ap-select"
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCreating(true)
              return
            }
            onChange(e.target.value || null)
          }}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ New category…</option>
        </select>
      )}
      {error && <p style={{ color: 'var(--ws-warn)', fontSize: 12.5, marginTop: 4 }}>{error}</p>}
    </Field>
  )
}

function Field({
  label,
  optional = false,
  help,
  error,
  children,
}: {
  label: string
  optional?: boolean
  help?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="ap-field">
      <div className="ap-field-label">
        <label>
          {label}
          {optional && <span className="ap-opt"> optional</span>}
        </label>
      </div>
      {children}
      {help && !error && <div className="ap-field-help">{help}</div>}
      {error && <p style={{ color: 'var(--ws-warn)', fontSize: 12.5, marginTop: 4 }}>{error}</p>}
    </div>
  )
}

function Chevron({ dir, size = 16 }: { dir: 'left' | 'right'; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke="currentColor"
      strokeWidth={1.75}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === 'left' ? <path d="M15 18 9 12l6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  )
}
