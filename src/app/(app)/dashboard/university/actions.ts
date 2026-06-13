'use server'

// WhatStage University — superadmin CMS server actions.
// Every action gates on role==='superadmin' BEFORE touching the admin DAL
// (src/lib/university/admin.ts), which is the only content writer.

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getSession } from '@/lib/auth/get-session'
import { UNIVERSITY_CATALOG_TAG } from '@/lib/university/data'
import {
  saveCourse,
  deleteCourse,
  setCourseStatus,
  reorderCourses,
  createCategory,
  type SaveCourseResult,
} from '@/lib/university/admin'
import { SLUG_RE, slugify } from '@/lib/university/slug'

async function requireSuperadmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'unauthenticated' }
  if (session.role !== 'superadmin') return { ok: false, error: 'forbidden' }
  return { ok: true, userId: session.userId }
}

function revalidateAll() {
  // Invalidate the cached published content (catalog + every per-course entry,
  // which all carry this tag). revalidatePath alone does NOT clear
  // unstable_cache entries, so the tag revalidation is required for freshness.
  // 'max' = stale-while-revalidate; superadmins read the live path so they
  // always see their edit immediately, end-users get fresh content in the bg.
  revalidateTag(UNIVERSITY_CATALOG_TAG, 'max')
  revalidatePath('/dashboard/university')
  revalidatePath('/university')
}

const lessonSchema = z.object({
  id: z.string().uuid().nullable(),
  slug: z.string().regex(SLUG_RE, 'Invalid lesson slug'),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).nullable(),
  provider: z.enum(['youtube', 'vimeo', 'loom', 'imagekit']),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 24).nullable(),
  isPreview: z.boolean(),
  providerInput: z.string().min(1).max(1000),
})

const saveSchema = z.object({
  courseId: z.string().uuid().nullable(),
  course: z.object({
    slug: z.string().regex(SLUG_RE, 'Invalid course slug'),
    title: z.string().min(1).max(160),
    subtitle: z.string().max(280).nullable(),
    description: z.string().max(8000).nullable(),
    coverImageUrl: z.string().max(1000).nullable(),
    categoryId: z.string().uuid().nullable(),
    accessLevel: z.enum(['public', 'authenticated', 'subscriber']),
  }),
  lessons: z.array(lessonSchema).max(200),
})

export type SaveCourseInput = z.infer<typeof saveSchema>

export async function saveCourseAction(input: SaveCourseInput): Promise<SaveCourseResult> {
  const auth = await requireSuperadmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', field: parsed.error.issues[0]?.path?.join('.') }
  }

  const result = await saveCourse(parsed.data.courseId, parsed.data.course, parsed.data.lessons, auth.userId)
  if (result.ok) revalidateAll()
  return result
}

export async function setCourseStatusAction(
  courseId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireSuperadmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!z.string().uuid().safeParse(courseId).success) return { ok: false, error: 'invalid id' }

  const result = await setCourseStatus(courseId, status)
  if (result.ok) revalidateAll()
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function deleteCourseAction(courseId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireSuperadmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!z.string().uuid().safeParse(courseId).success) return { ok: false, error: 'invalid id' }

  const result = await deleteCourse(courseId)
  if (result.ok) revalidateAll()
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function reorderCoursesAction(orderedIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireSuperadmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const parsed = z.array(z.string().uuid()).max(500).safeParse(orderedIds)
  if (!parsed.success) return { ok: false, error: 'invalid ids' }

  await reorderCourses(parsed.data)
  revalidateAll()
  return { ok: true }
}

export async function createCategoryAction(
  name: string,
): Promise<{ ok: true; category: { id: string; slug: string; name: string } } | { ok: false; error: string }> {
  const auth = await requireSuperadmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const trimmed = (name ?? '').trim()
  if (trimmed.length < 1 || trimmed.length > 80) return { ok: false, error: 'Enter a category name (1–80 chars).' }
  const slug = slugify(trimmed)
  if (!slug) return { ok: false, error: 'Category name needs at least a couple of letters/numbers.' }

  const result = await createCategory(slug, trimmed)
  if (!result.ok) return result
  // Categories are part of the cached public catalog (filter chips).
  revalidateTag(UNIVERSITY_CATALOG_TAG, 'max')
  revalidatePath('/dashboard/university')
  return { ok: true, category: { id: result.id, slug: result.slug, name: result.name } }
}
