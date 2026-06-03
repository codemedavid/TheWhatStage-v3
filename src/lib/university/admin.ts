// WhatStage University — superadmin write DAL (server-only, service-role).
//
// This is the ONLY module that writes university content and the ONLY place that
// reads university_lesson_sources for editing. Callers (route handlers / server
// actions) MUST verify role==='superadmin' via getSession() BEFORE calling these.

import { createAdminClient } from '@/lib/supabase/admin'
import { parseProviderRef, formatProviderRef, type ParsedRef } from './providers'
import type { AccessLevel, CourseStatus, VideoProvider } from './types'

// ---------- input/output shapes ----------

export type CourseInput = {
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  coverImageUrl: string | null
  categoryId: string | null
  accessLevel: AccessLevel
}

export type LessonInput = {
  id: string | null
  slug: string
  title: string
  summary: string | null
  provider: VideoProvider
  durationSeconds: number | null
  isPreview: boolean
  providerInput: string // raw URL/ID — parsed + validated here
}

export type SaveCourseResult =
  | { ok: true; courseId: string }
  | { ok: false; error: string; field?: string }

export type AdminCourseListRow = {
  id: string
  slug: string
  title: string
  accessLevel: AccessLevel
  status: CourseStatus
  lessonCount: number
  position: number
  updatedAt: string
  category: { slug: string; name: string } | null
}

export type AdminLessonDraft = {
  id: string
  slug: string
  title: string
  summary: string | null
  provider: VideoProvider
  durationSeconds: number | null
  position: number
  isPreview: boolean
  providerInput: string
}

export type AdminCourseDetail = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  coverImageUrl: string | null
  categoryId: string | null
  accessLevel: AccessLevel
  status: CourseStatus
  lessons: AdminLessonDraft[]
}

const STATUS_WEIGHT: Record<CourseStatus, number> = { draft: 0, published: 1, archived: 2 }

function normalizeCategory(c: unknown): { slug: string; name: string } | null {
  if (!c) return null
  const obj = Array.isArray(c) ? c[0] : c
  if (!obj || typeof obj !== 'object') return null
  const slug = (obj as Record<string, unknown>).slug
  const name = (obj as Record<string, unknown>).name
  return typeof slug === 'string' && typeof name === 'string' ? { slug, name } : null
}

function friendlyCourseError(msg: string): string {
  if (/duplicate key|university_courses_slug_key|unique/i.test(msg)) return 'That URL slug is already taken.'
  if (/violates check constraint.*slug/i.test(msg)) return 'Slug must be lowercase letters, numbers and dashes.'
  return msg
}

function friendlyLessonError(input: LessonInput, msg: string): string {
  const where = `Lesson "${input.title || input.slug}"`
  if (/duplicate key|unique/i.test(msg)) return `${where}: two lessons can't share the same slug.`
  if (/violates check constraint.*slug/i.test(msg)) return `${where}: slug must be lowercase letters, numbers and dashes.`
  return `${where}: ${msg}`
}

// ---------- reads (admin view: includes drafts + source refs) ----------

export async function listAdminCourses(): Promise<AdminCourseListRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('university_courses')
    .select('id, slug, title, access_level, status, lesson_count, position, updated_at, category:university_categories(slug, name)')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      title: c.title as string,
      accessLevel: c.access_level as AccessLevel,
      status: c.status as CourseStatus,
      lessonCount: (c.lesson_count as number) ?? 0,
      position: (c.position as number) ?? 0,
      updatedAt: c.updated_at as string,
      category: normalizeCategory(c.category),
    }))
    .sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getAdminCourse(courseId: string): Promise<AdminCourseDetail | null> {
  const admin = createAdminClient()
  const { data: c } = await admin
    .from('university_courses')
    .select('id, slug, title, subtitle, description, cover_image_url, category_id, access_level, status')
    .eq('id', courseId)
    .maybeSingle()
  if (!c) return null
  const course = c as Record<string, unknown>

  const { data: lessonData } = await admin
    .from('university_lessons')
    .select('id, slug, title, summary, provider, duration_seconds, position, is_preview')
    .eq('course_id', courseId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const lessons = (lessonData ?? []) as Array<Record<string, unknown>>

  const ids = lessons.map((l) => l.id as string)
  const srcById = new Map<string, ParsedRef>()
  if (ids.length) {
    const { data: sources } = await admin
      .from('university_lesson_sources')
      .select('lesson_id, provider_video_id, provider_hash, source_path')
      .in('lesson_id', ids)
    for (const s of (sources ?? []) as Array<Record<string, unknown>>) {
      srcById.set(s.lesson_id as string, {
        providerVideoId: (s.provider_video_id as string | null) ?? null,
        providerHash: (s.provider_hash as string | null) ?? null,
        sourcePath: (s.source_path as string | null) ?? null,
      })
    }
  }

  return {
    id: course.id as string,
    slug: course.slug as string,
    title: course.title as string,
    subtitle: (course.subtitle as string | null) ?? null,
    description: (course.description as string | null) ?? null,
    coverImageUrl: (course.cover_image_url as string | null) ?? null,
    categoryId: (course.category_id as string | null) ?? null,
    accessLevel: course.access_level as AccessLevel,
    status: course.status as CourseStatus,
    lessons: lessons.map((l) => {
      const provider = l.provider as VideoProvider
      const ref = srcById.get(l.id as string) ?? { providerVideoId: null, providerHash: null, sourcePath: null }
      return {
        id: l.id as string,
        slug: l.slug as string,
        title: l.title as string,
        summary: (l.summary as string | null) ?? null,
        provider,
        durationSeconds: (l.duration_seconds as number | null) ?? null,
        position: (l.position as number) ?? 0,
        isPreview: (l.is_preview as boolean) ?? false,
        providerInput: formatProviderRef(provider, ref),
      }
    }),
  }
}

export async function listAdminCategories(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('university_categories')
    .select('id, slug, name')
    .order('position', { ascending: true })
  return (data ?? []) as Array<{ id: string; slug: string; name: string }>
}

export async function createCategory(
  slug: string,
  name: string,
): Promise<{ ok: true; id: string; slug: string; name: string } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('university_categories')
    .insert({ slug, name })
    .select('id, slug, name')
    .single()
  if (error) {
    return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'A category with that name already exists.' : error.message }
  }
  return { ok: true, id: data!.id as string, slug: data!.slug as string, name: data!.name as string }
}

// ---------- writes ----------

export async function saveCourse(
  courseId: string | null,
  course: CourseInput,
  lessons: LessonInput[],
  createdBy?: string | null,
): Promise<SaveCourseResult> {
  // Parse every provider ref FIRST — fail fast, never half-write.
  const parsed: Array<{ input: LessonInput; ref: ParsedRef }> = []
  for (const l of lessons) {
    const pr = parseProviderRef(l.provider, l.providerInput)
    if (!pr.ok) return { ok: false, error: `Lesson "${l.title || l.slug}": ${pr.error}`, field: 'lessons' }
    parsed.push({ input: l, ref: pr.ref })
  }

  const admin = createAdminClient()
  const payload = {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    cover_image_url: course.coverImageUrl,
    category_id: course.categoryId,
    access_level: course.accessLevel,
  }

  let id = courseId
  if (id === null) {
    const { data, error } = await admin
      .from('university_courses')
      .insert({ ...payload, created_by: createdBy ?? null })
      .select('id')
      .single()
    if (error) return { ok: false, error: friendlyCourseError(error.message), field: 'slug' }
    id = data!.id as string
  } else {
    const { error } = await admin.from('university_courses').update(payload).eq('id', id)
    if (error) return { ok: false, error: friendlyCourseError(error.message), field: 'slug' }
  }

  const { data: existing } = await admin.from('university_lessons').select('id').eq('course_id', id)
  const existingIds = new Set(((existing ?? []) as Array<{ id: string }>).map((r) => r.id))
  const keepIds = new Set<string>()

  for (let i = 0; i < parsed.length; i++) {
    const { input, ref } = parsed[i]
    const { data, error } = await admin.rpc('superadmin_upsert_lesson', {
      p_lesson_id: input.id,
      p_course_id: id,
      p_slug: input.slug,
      p_title: input.title,
      p_summary: input.summary,
      p_provider: input.provider,
      p_duration_seconds: input.durationSeconds,
      p_position: i,
      p_is_preview: input.isPreview,
      p_provider_video_id: ref.providerVideoId,
      p_provider_hash: ref.providerHash,
      p_source_path: ref.sourcePath,
    })
    if (error) return { ok: false, error: friendlyLessonError(input, error.message), field: 'lessons' }
    if (typeof data === 'string') keepIds.add(data)
    else if (input.id) keepIds.add(input.id)
  }

  const toDelete = [...existingIds].filter((eid) => !keepIds.has(eid))
  if (toDelete.length) {
    await admin.from('university_lessons').delete().in('id', toDelete)
  }

  return { ok: true, courseId: id }
}

async function assertPublishable(
  admin: ReturnType<typeof createAdminClient>,
  courseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: lessons } = await admin.from('university_lessons').select('id').eq('course_id', courseId)
  const ids = ((lessons ?? []) as Array<{ id: string }>).map((l) => l.id)
  if (ids.length === 0) return { ok: false, error: 'Add at least one playable lesson before publishing.' }
  const { data: sources } = await admin
    .from('university_lesson_sources')
    .select('lesson_id, provider_video_id, source_path')
    .in('lesson_id', ids)
  const ready = new Set(
    ((sources ?? []) as Array<Record<string, unknown>>)
      .filter((s) => s.provider_video_id || s.source_path)
      .map((s) => s.lesson_id as string),
  )
  if (ready.size < ids.length) return { ok: false, error: 'Every lesson needs a valid video before publishing.' }
  return { ok: true }
}

export async function setCourseStatus(
  courseId: string,
  status: CourseStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (status === 'published') {
    const guard = await assertPublishable(admin, courseId)
    if (!guard.ok) return guard
  }
  const patch: Record<string, unknown> = { status }
  if (status === 'published') patch.published_at = new Date().toISOString()
  const { error } = await admin.from('university_courses').update(patch).eq('id', courseId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { error } = await admin.from('university_courses').delete().eq('id', courseId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function reorderCourses(orderedIds: string[]): Promise<void> {
  const admin = createAdminClient()
  await Promise.all(
    orderedIds.map((id, i) => admin.from('university_courses').update({ position: i }).eq('id', id)),
  )
}
