// WhatStage University — progress reads (server-only).
// Writes go through saveProgressAction → upsert_lesson_progress RPC (entitlement
// re-checked in the DB). These helpers only READ the owner's rows (RLS owner-only).

import type { SupabaseClient } from '@supabase/supabase-js'

export type ProgressRow = {
  lesson_id: string
  course_id: string
  resume_seconds: number
  completed_at: string | null
  last_watched_at: string
}

export async function fetchCourseProgress(
  supabase: SupabaseClient,
  userId: string,
  courseId: string,
): Promise<ProgressRow[]> {
  const { data } = await supabase
    .from('university_progress')
    .select('lesson_id, course_id, resume_seconds, completed_at, last_watched_at')
    .eq('user_id', userId)
    .eq('course_id', courseId)
  return (data ?? []) as ProgressRow[]
}

export async function fetchAllProgress(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProgressRow[]> {
  const { data } = await supabase
    .from('university_progress')
    .select('lesson_id, course_id, resume_seconds, completed_at, last_watched_at')
    .eq('user_id', userId)
    .order('last_watched_at', { ascending: false })
  return (data ?? []) as ProgressRow[]
}

export function coursePct(total: number, completed: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
}
