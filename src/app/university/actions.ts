'use server'

// WhatStage University — public progress server actions.
// These call the upsert_lesson_progress RPC under the caller's session (cookie
// anon client). The RPC re-checks entitlement and returns false for anon or for
// lessons the viewer can't watch. Best-effort: never throws into the player.

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const progressSchema = z.object({
  lessonId: z.string().uuid(),
  resumeSeconds: z.number().int().min(0).max(60 * 60 * 24),
})

const completeSchema = z.object({
  lessonId: z.string().uuid(),
  resumeSeconds: z.number().int().min(0).max(60 * 60 * 24).optional(),
})

export async function saveProgressAction(input: {
  lessonId: string
  resumeSeconds: number
}): Promise<{ ok: boolean }> {
  const parsed = progressSchema.safeParse(input)
  if (!parsed.success) return { ok: false }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('upsert_lesson_progress', {
      p_lesson_id: parsed.data.lessonId,
      p_resume_seconds: parsed.data.resumeSeconds,
      p_complete: false,
    })
    if (error) {
      console.error('[university.saveProgress] rpc failed', error.message)
      return { ok: false }
    }
    return { ok: data === true }
  } catch (e) {
    console.error('[university.saveProgress] threw', e)
    return { ok: false }
  }
}

export async function markLessonCompleteAction(input: {
  lessonId: string
  resumeSeconds?: number
}): Promise<{ ok: boolean }> {
  const parsed = completeSchema.safeParse(input)
  if (!parsed.success) return { ok: false }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('upsert_lesson_progress', {
      p_lesson_id: parsed.data.lessonId,
      p_resume_seconds: parsed.data.resumeSeconds ?? 0,
      p_complete: true,
    })
    if (error) {
      console.error('[university.markComplete] rpc failed', error.message)
      return { ok: false }
    }
    return { ok: data === true }
  } catch (e) {
    console.error('[university.markComplete] threw', e)
    return { ok: false }
  }
}
