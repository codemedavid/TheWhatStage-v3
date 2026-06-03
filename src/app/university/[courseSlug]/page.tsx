import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { getCatalog, getCourseDetail } from '@/lib/university/data'
import { getEntitlement, getViewer } from '@/lib/university/access'
import type { CourseCardVM, Viewer } from '@/lib/university/types'
import { CourseDetailClient } from './_components/CourseDetailClient'
import type { CtaState } from './_components/CtaPanel'

// CTA state matrix (§3.6) derived from access_level × viewer × progress.
function computeCtaState(args: {
  accessLevel: CourseCardVM['accessLevel']
  viewer: Viewer
  allowed: boolean
  progressPct: number | null
  completed: boolean
}): CtaState {
  const { accessLevel, viewer, allowed, progressPct, completed } = args

  // Entitled viewers: progress decides D / E / F.
  if (allowed) {
    if (completed) return 'F'
    if ((progressPct ?? 0) > 0) return 'E'
    // Not started — public→A, otherwise "included" D.
    return accessLevel === 'public' ? 'A' : 'D'
  }

  // Not entitled → the gated conversion states.
  // subscriber course → pay (C); authenticated course → sign in (B).
  if (accessLevel === 'subscriber') return 'C'
  if (accessLevel === 'authenticated') {
    // guest sees B (sign-in); a logged-in member is always entitled to an
    // authenticated course, so this branch is effectively guests-only.
    return viewer === 'guest' ? 'B' : 'D'
  }
  // public course is never gated; fall back to start.
  return 'A'
}

function ctaLabelForCard(card: CourseCardVM, viewer: Viewer, allowed: boolean): string {
  if (allowed) {
    if (card.completed) return 'Rewatch'
    if ((card.progressPct ?? 0) > 0) return 'Continue'
    return 'Start'
  }
  if (card.accessLevel === 'subscriber') {
    return viewer === 'guest' ? '✦ Unlock with Pro' : '✦ Upgrade to unlock'
  }
  if (card.accessLevel === 'authenticated') return '⊟ Sign in to start'
  return 'Start free'
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseSlug: string }>
}) {
  const { courseSlug } = await params
  const session = await getSession()

  const detail = await getCourseDetail(session, courseSlug)
  if (!detail) notFound()

  const { course, lessons, coursePct, resume } = detail
  const viewer = getViewer(session)

  // Course-level entitlement (ignores per-lesson preview) drives the CTA state.
  const courseEnt = getEntitlement(session, { accessLevel: course.accessLevel, status: 'published' })

  const ctaState = computeCtaState({
    accessLevel: course.accessLevel,
    viewer,
    allowed: courseEnt.allowed,
    progressPct: course.progressPct,
    completed: course.completed,
  })

  const previewLesson = lessons.find((l) => l.isPreview) ?? null
  const firstLesson = lessons[0] ?? null

  // Related courses — same category first, then fill from the catalog. Compute a
  // per-card CTA + lock from the viewer's entitlement.
  let related: Array<{ course: typeof course; href: string; ctaLabel: string; locked: boolean }> = []
  try {
    const catalog = await getCatalog(session)
    const pool = catalog.courses.filter((c) => c.slug !== course.slug)
    const sameCat = pool.filter((c) => c.category?.slug && c.category.slug === course.category?.slug)
    const rest = pool.filter((c) => !(c.category?.slug && c.category.slug === course.category?.slug))
    const picked = [...sameCat, ...rest].slice(0, 3)
    related = picked.map((c) => {
      const ent = getEntitlement(session, { accessLevel: c.accessLevel, status: 'published' })
      return {
        course: { ...c, description: null },
        href: `/university/${c.slug}`,
        ctaLabel: ctaLabelForCard(c, viewer, ent.allowed),
        locked: !ent.allowed,
      }
    })
  } catch {
    related = []
  }

  // "Up next" cross-sell for the completed (F) state.
  const nextCourse = related[0] ? { slug: related[0].course.slug, title: related[0].course.title } : null

  return (
    <CourseDetailClient
      course={course}
      lessons={lessons}
      coursePct={coursePct}
      resume={resume}
      ctaState={ctaState}
      viewer={viewer}
      previewLessonSlug={previewLesson?.slug ?? null}
      firstLessonSlug={firstLesson?.slug ?? null}
      nextCourse={nextCourse}
      related={related}
    />
  )
}
