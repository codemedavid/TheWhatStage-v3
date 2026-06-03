// WhatStage University — public read DAL (server-only).
//
// SECURITY: every read here uses the cookie-bound ANON client (createClient),
// so RLS is the enforcer (published rows for everyone; drafts for superadmin).
// This module MUST NEVER select from university_lesson_sources — the playable
// source is obtained ONLY via playback.ts -> get_lesson_playback() RPC.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { SessionContext } from '@/lib/auth/get-session'
import { getEntitlement, type Entitlement } from './access'
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
  const supabase = await createClient()

  const [coursesRes, categoriesRes] = await Promise.all([
    supabase
      .from('university_courses')
      .select(COURSE_COLS)
      .eq('status', 'published')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false }),
    supabase
      .from('university_categories')
      .select('slug, name')
      .order('position', { ascending: true }),
  ])

  const courseRows = (coursesRes.data ?? []) as CourseRow[]
  const categories = (categoriesRes.data ?? []) as CategoryVM[]

  const completedByCourse = new Map<string, number>()
  let progressRows: ProgressRow[] = []
  if (session) {
    progressRows = await fetchAllProgress(supabase, session.userId)
    for (const p of progressRows) {
      if (p.completed_at) completedByCourse.set(p.course_id, (completedByCourse.get(p.course_id) ?? 0) + 1)
    }
  }

  const courses = courseRows.map((c) =>
    mapCourseCard(c, session ? { total: c.lesson_count, completed: completedByCourse.get(c.id) ?? 0 } : undefined),
  )

  const continueItems = session
    ? await buildContinueItems(supabase, courseRows, progressRows, completedByCourse)
    : []

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
  supabase: SupabaseClient,
  session: SessionContext | null,
  courseSlug: string,
): Promise<LoadedCourse | null> {
  const { data: courseData } = await supabase
    .from('university_courses')
    .select(COURSE_COLS_DETAIL)
    .eq('slug', courseSlug)
    .maybeSingle()
  if (!courseData) return null
  const course = courseData as CourseRow

  const { data: lessonData } = await supabase
    .from('university_lessons')
    .select(LESSON_COLS)
    .eq('course_id', course.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const lessonRows = (lessonData ?? []) as LessonRow[]

  const progressByLesson = new Map<string, ProgressRow>()
  let completed = 0
  if (session) {
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
  const supabase = await createClient()
  const loaded = await loadCourseWithLessons(supabase, session, courseSlug)
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
  const supabase = await createClient()
  const loaded = await loadCourseWithLessons(supabase, session, courseSlug)
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
