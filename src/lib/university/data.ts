// WhatStage University — public read DAL (server-only).
//
// SECURITY: every read here uses the cookie-bound ANON client (createClient),
// so RLS is the enforcer (published rows for everyone; drafts for superadmin).
// This module MUST NEVER select from university_lesson_sources — the playable
// source is obtained ONLY via playback.ts -> get_lesson_playback() RPC.

import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SessionContext } from '@/lib/auth/get-session'
import { getEntitlement, isSuperadmin, type Entitlement } from './access'
import { coursePct, fetchAllProgress, fetchCourseProgress, type ProgressRow } from './progress'
import type {
  AccessLevel,
  CategoryVM,
  CourseStatus,
  CourseCardVM,
  CourseDetailVM,
  LessonRowVM,
  ResumeVM,
  VideoProvider,
} from './types'

type CourseRow = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description?: string | null
  cover_image_url: string | null
  access_level: AccessLevel
  status: CourseStatus
  lesson_count: number
  total_duration_seconds: number
  position: number
  category: unknown
}

type LessonRow = {
  id: string
  slug: string
  title: string
  summary: string | null
  provider: VideoProvider
  duration_seconds: number | null
  position: number
  is_preview: boolean
}

const COURSE_COLS =
  'id, slug, title, subtitle, cover_image_url, access_level, status, lesson_count, total_duration_seconds, position, category:university_categories(slug, name)'
const COURSE_COLS_DETAIL =
  'id, slug, title, subtitle, description, cover_image_url, access_level, status, lesson_count, total_duration_seconds, position, category:university_categories(slug, name)'
const LESSON_COLS = 'id, slug, title, summary, provider, duration_seconds, position, is_preview'

// ---------------------------------------------------------------------------
// Cached content layer (session-independent, published-only).
//
// Published course/lesson/category CONTENT is identical for every viewer and
// only changes when a superadmin edits via the CMS, so we cache it across
// requests with unstable_cache and invalidate on-demand by tag (see actions.ts).
// Per-user data (progress, entitlement) is layered on live, below.
//
// SECURITY: these readers use the service-role client but ALWAYS filter
// status='published', so they can only ever return what an anonymous viewer
// would see via RLS — no draft leak. They never touch university_lesson_sources.
// Superadmin draft preview is served by the LIVE path (loadCourseContent),
// which uses the cookie-bound client and RLS.

/** Tag carried by EVERY cached university-content entry. Revalidating it
 *  invalidates the catalog and all per-course content in one shot. */
export const UNIVERSITY_CATALOG_TAG = 'university-catalog'
/** Per-course tag for targeted invalidation. */
export function universityCourseTag(slug: string): string {
  return `university-course:${slug}`
}
// Time-based safety net; on-demand revalidateTag is the primary mechanism.
const CONTENT_REVALIDATE_SECONDS = 60 * 60

type CatalogContent = { courses: CourseRow[]; categories: CategoryVM[] }
type CourseContent = { course: CourseRow; lessons: LessonRow[] }

const getCatalogContent = unstable_cache(
  async (): Promise<CatalogContent> => {
    const admin = createAdminClient()
    const [coursesRes, categoriesRes] = await Promise.all([
      admin
        .from('university_courses')
        .select(COURSE_COLS)
        .eq('status', 'published')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }),
      admin.from('university_categories').select('slug, name').order('position', { ascending: true }),
    ])
    return {
      courses: (coursesRes.data ?? []) as CourseRow[],
      categories: (categoriesRes.data ?? []) as CategoryVM[],
    }
  },
  ['university-catalog-content'],
  { tags: [UNIVERSITY_CATALOG_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
)

/** Cached published course content by slug. The per-slug tag enables targeted
 *  invalidation; the catalog tag is also attached so a single revalidate of
 *  UNIVERSITY_CATALOG_TAG clears every course entry too. */
function getCourseContentCached(slug: string): Promise<CourseContent | null> {
  return unstable_cache(
    async (): Promise<CourseContent | null> => {
      const admin = createAdminClient()
      const { data: courseData } = await admin
        .from('university_courses')
        .select(COURSE_COLS_DETAIL)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle()
      if (!courseData) return null
      const course = courseData as CourseRow
      const { data: lessonData } = await admin
        .from('university_lessons')
        .select(LESSON_COLS)
        .eq('course_id', course.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
      return { course, lessons: (lessonData ?? []) as LessonRow[] }
    },
    ['university-course-content', slug],
    { tags: [UNIVERSITY_CATALOG_TAG, universityCourseTag(slug)], revalidate: CONTENT_REVALIDATE_SECONDS },
  )()
}

/** Live, RLS-gated course content (cookie client). Used ONLY for superadmin so
 *  draft preview on the public site keeps working — drafts must never be cached. */
async function getCourseContentLive(
  supabase: SupabaseClient,
  slug: string,
): Promise<CourseContent | null> {
  const { data: courseData } = await supabase
    .from('university_courses')
    .select(COURSE_COLS_DETAIL)
    .eq('slug', slug)
    .maybeSingle()
  if (!courseData) return null
  const course = courseData as CourseRow
  const { data: lessonData } = await supabase
    .from('university_lessons')
    .select(LESSON_COLS)
    .eq('course_id', course.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  return { course, lessons: (lessonData ?? []) as LessonRow[] }
}

/** Acquire course content: cached published for everyone, live (drafts) for superadmin. */
async function loadCourseContent(
  session: SessionContext | null,
  slug: string,
): Promise<CourseContent | null> {
  if (isSuperadmin(session)) {
    const supabase = await createClient()
    return getCourseContentLive(supabase, slug)
  }
  return getCourseContentCached(slug)
}

function stripId<T extends { id: string }>(o: T): Omit<T, 'id'> {
  const copy: Record<string, unknown> = { ...o }
  delete copy.id
  return copy as Omit<T, 'id'>
}

function normalizeCategory(c: unknown): CategoryVM | null {
  if (!c) return null
  const obj = Array.isArray(c) ? c[0] : c
  if (!obj || typeof obj !== 'object') return null
  const slug = (obj as Record<string, unknown>).slug
  const name = (obj as Record<string, unknown>).name
  return typeof slug === 'string' && typeof name === 'string' ? { slug, name } : null
}

function mapCourseCard(
  c: CourseRow,
  progress?: { total: number; completed: number },
): CourseCardVM {
  return {
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    coverImageUrl: c.cover_image_url,
    category: normalizeCategory(c.category),
    accessLevel: c.access_level,
    lessonCount: c.lesson_count,
    durationSeconds: c.total_duration_seconds,
    progressPct: progress ? coursePct(progress.total, progress.completed) : null,
    completed: progress ? progress.total > 0 && progress.completed >= progress.total : false,
  }
}

export type CatalogData = {
  courses: CourseCardVM[]
  categories: CategoryVM[]
  continueItems: ResumeVM[]
}

export async function getCatalog(session: SessionContext | null): Promise<CatalogData> {
  // Published catalog content is shared across all viewers → served from cache.
  const { courses: courseRows, categories } = await getCatalogContent()

  const completedByCourse = new Map<string, number>()
  let progressRows: ProgressRow[] = []
  let continueItems: ResumeVM[] = []
  if (session) {
    // Per-user progress overlay stays live (RLS owner-only, cookie client).
    const supabase = await createClient()
    progressRows = await fetchAllProgress(supabase, session.userId)
    for (const p of progressRows) {
      if (p.completed_at) completedByCourse.set(p.course_id, (completedByCourse.get(p.course_id) ?? 0) + 1)
    }
    continueItems = await buildContinueItems(supabase, courseRows, progressRows, completedByCourse)
  }

  const courses = courseRows.map((c) =>
    mapCourseCard(c, session ? { total: c.lesson_count, completed: completedByCourse.get(c.id) ?? 0 } : undefined),
  )

  return { courses, categories, continueItems }
}

async function buildContinueItems(
  supabase: SupabaseClient,
  courseRows: CourseRow[],
  progressRows: ProgressRow[],
  completedByCourse: Map<string, number>,
): Promise<ResumeVM[]> {
  const courseById = new Map(courseRows.map((c) => [c.id, c]))
  const byCourse = new Map<string, ProgressRow[]>()
  for (const p of progressRows) {
    if (!courseById.has(p.course_id)) continue // only published courses surface here
    const arr = byCourse.get(p.course_id) ?? []
    arr.push(p)
    byCourse.set(p.course_id, arr)
  }

  type Pick = { course: CourseRow; resume: ProgressRow; recent: string }
  const picks: Pick[] = []
  for (const [courseId, rows] of byCourse) {
    const course = courseById.get(courseId)!
    const completed = completedByCourse.get(courseId) ?? 0
    if (course.lesson_count > 0 && completed >= course.lesson_count) continue // fully done
    const incomplete = rows.filter((r) => !r.completed_at)
    const resume = incomplete[0] ?? rows[0] // rows are desc by last_watched
    picks.push({ course, resume, recent: rows[0].last_watched_at })
  }
  picks.sort((a, b) => (a.recent < b.recent ? 1 : -1))
  const top = picks.slice(0, 8)
  if (top.length === 0) return []

  const { data: lessonData } = await supabase
    .from('university_lessons')
    .select('id, slug, title, position')
    .in('id', top.map((p) => p.resume.lesson_id))
  const lessonById = new Map(
    ((lessonData ?? []) as Array<{ id: string; slug: string; title: string; position: number }>).map((l) => [l.id, l]),
  )

  const items: ResumeVM[] = []
  for (const p of top) {
    const l = lessonById.get(p.resume.lesson_id)
    if (!l) continue
    const completed = completedByCourse.get(p.course.id) ?? 0
    items.push({
      courseSlug: p.course.slug,
      courseTitle: p.course.title,
      coverImageUrl: p.course.cover_image_url,
      lessonSlug: l.slug,
      lessonTitle: l.title,
      lessonNumber: (l.position ?? 0) + 1,
      lessonCount: p.course.lesson_count,
      progressPct: coursePct(p.course.lesson_count, completed),
      resumeSeconds: p.resume.resume_seconds,
    })
  }
  return items
}

type LoadedCourse = {
  course: CourseDetailVM
  lessons: Array<LessonRowVM & { id: string }>
  coursePct: number
  resume: { lessonSlug: string; seconds: number } | null
  courseGate: { accessLevel: AccessLevel; status: CourseStatus }
}

async function loadCourseWithLessons(
  session: SessionContext | null,
  courseSlug: string,
): Promise<LoadedCourse | null> {
  // Content: cached published rows (or live drafts for superadmin preview).
  const content = await loadCourseContent(session, courseSlug)
  if (!content) return null
  const { course, lessons: lessonRows } = content

  const progressByLesson = new Map<string, ProgressRow>()
  let completed = 0
  if (session) {
    // Per-user progress overlay stays live (RLS owner-only, cookie client).
    const supabase = await createClient()
    const rows = await fetchCourseProgress(supabase, session.userId, course.id)
    for (const r of rows) {
      progressByLesson.set(r.lesson_id, r)
      if (r.completed_at) completed++
    }
  }

  const courseGate = { accessLevel: course.access_level, status: course.status }
  const lessons = lessonRows.map((l) => {
    const p = progressByLesson.get(l.id)
    const ent = getEntitlement(session, courseGate, { isPreview: l.is_preview })
    return {
      id: l.id,
      slug: l.slug,
      title: l.title,
      summary: l.summary,
      durationSeconds: l.duration_seconds,
      position: l.position,
      isPreview: l.is_preview,
      provider: l.provider,
      locked: !ent.allowed,
      completed: !!p?.completed_at,
      inProgress: !!p && !p.completed_at && (p.resume_seconds ?? 0) > 0,
      resumeSeconds: p?.resume_seconds ?? 0,
    }
  })

  const pct = coursePct(lessonRows.length, completed)

  const courseVM: CourseDetailVM = {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description ?? null,
    coverImageUrl: course.cover_image_url,
    category: normalizeCategory(course.category),
    accessLevel: course.access_level,
    lessonCount: lessonRows.length,
    durationSeconds: course.total_duration_seconds,
    progressPct: session ? pct : null,
    completed: session ? lessonRows.length > 0 && completed >= lessonRows.length : false,
  }

  let resume: { lessonSlug: string; seconds: number } | null = null
  if (session && lessonRows.length > 0) {
    const watched = [...progressByLesson.values()].sort((a, b) => (a.last_watched_at < b.last_watched_at ? 1 : -1))
    const recentIncomplete = watched.find((w) => !w.completed_at)
    if (recentIncomplete) {
      const l = lessons.find((x) => x.id === recentIncomplete.lesson_id)
      if (l) resume = { lessonSlug: l.slug, seconds: recentIncomplete.resume_seconds }
    }
    if (!resume) {
      const firstIncomplete = lessons.find((l) => !l.completed) ?? lessons[0]
      resume = { lessonSlug: firstIncomplete.slug, seconds: firstIncomplete.resumeSeconds }
    }
  }

  return { course: courseVM, lessons, coursePct: pct, resume, courseGate }
}

export type CourseDetailData = {
  course: CourseDetailVM
  lessons: LessonRowVM[]
  coursePct: number
  resume: { lessonSlug: string; seconds: number } | null
}

export async function getCourseDetail(
  session: SessionContext | null,
  courseSlug: string,
): Promise<CourseDetailData | null> {
  const loaded = await loadCourseWithLessons(session, courseSlug)
  if (!loaded) return null
  return {
    course: loaded.course,
    lessons: loaded.lessons.map(stripId),
    coursePct: loaded.coursePct,
    resume: loaded.resume,
  }
}

export type LessonContextData = {
  course: CourseDetailVM
  lesson: LessonRowVM
  lessonId: string
  lessons: LessonRowVM[]
  coursePct: number
  entitlement: Entitlement
  prevSlug: string | null
  nextSlug: string | null
}

export async function loadLessonContext(
  session: SessionContext | null,
  courseSlug: string,
  lessonSlug: string,
): Promise<LessonContextData | null> {
  const loaded = await loadCourseWithLessons(session, courseSlug)
  if (!loaded) return null

  const idx = loaded.lessons.findIndex((l) => l.slug === lessonSlug)
  if (idx === -1) return null

  const { id, ...lessonVM } = loaded.lessons[idx]
  const entitlement = getEntitlement(session, loaded.courseGate, { isPreview: lessonVM.isPreview })

  return {
    course: loaded.course,
    lesson: lessonVM,
    lessonId: id,
    lessons: loaded.lessons.map(stripId),
    coursePct: loaded.coursePct,
    entitlement,
    prevSlug: idx > 0 ? loaded.lessons[idx - 1].slug : null,
    nextSlug: idx < loaded.lessons.length - 1 ? loaded.lessons[idx + 1].slug : null,
  }
}
