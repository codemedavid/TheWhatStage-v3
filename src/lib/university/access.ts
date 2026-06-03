// WhatStage University — entitlement (access control), app-layer mirror of the
// SQL truth table in 20260610000200_university_rpcs.sql.
//
// IMPORTANT: this is ADVISORY UX. The authoritative wall is the DB:
//   - get_lesson_playback() re-derives entitlement before returning any source
//   - university_lesson_sources has no client read path
// Even if this file had a bug, a gated source can't leak. access.test.ts pins
// this to the same truth table as the RPC.

import type { SessionContext } from '@/lib/auth/get-session'
import type { AccessLevel, CourseStatus, Viewer } from './types'

/** "Subscriber" == paid tier OR staff. Mirrors public.is_subscriber(). */
export function isSubscriber(session: SessionContext | null): boolean {
  if (!session) return false
  return (
    session.subscriptionTier === 'pro' ||
    session.role === 'admin' ||
    session.role === 'superadmin'
  )
}

export function isSuperadmin(session: SessionContext | null): boolean {
  return session?.role === 'superadmin'
}

/** The viewer bucket that drives every gated surface. */
export function getViewer(session: SessionContext | null): Viewer {
  if (!session) return 'guest'
  return isSubscriber(session) ? 'subscriber' : 'member'
}

export type EntitlementReason =
  | 'ok'
  | 'needs_login'
  | 'needs_subscription'
  | 'not_found'

export type Entitlement = { allowed: boolean; reason: EntitlementReason }

type CourseGate = { accessLevel: AccessLevel; status: CourseStatus }
type LessonGate = { isPreview: boolean }

/**
 * Can this viewer play this lesson (or, when no lesson is given, start this course)?
 * Matches the RPC truth table exactly.
 */
export function getEntitlement(
  session: SessionContext | null,
  course: CourseGate,
  lesson?: LessonGate,
): Entitlement {
  // Unpublished is invisible to everyone except superadmin (preview).
  if (course.status !== 'published') {
    return isSuperadmin(session)
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'not_found' }
  }

  if (isSuperadmin(session)) return { allowed: true, reason: 'ok' }

  // A preview lesson is playable by anyone, regardless of course access level.
  if (lesson?.isPreview) return { allowed: true, reason: 'ok' }

  switch (course.accessLevel) {
    case 'public':
      return { allowed: true, reason: 'ok' }
    case 'authenticated':
      return session
        ? { allowed: true, reason: 'ok' }
        : { allowed: false, reason: 'needs_login' }
    case 'subscriber':
      if (!session) return { allowed: false, reason: 'needs_login' }
      return isSubscriber(session)
        ? { allowed: true, reason: 'ok' }
        : { allowed: false, reason: 'needs_subscription' }
    default:
      return { allowed: false, reason: 'not_found' }
  }
}

/** Course-level convenience (ignores per-lesson preview). */
export function canAccessCourse(session: SessionContext | null, course: CourseGate): boolean {
  return getEntitlement(session, course).allowed
}
