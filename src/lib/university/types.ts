// WhatStage University — shared enums, DTOs and view-models.
// Pure types + const tuples. Safe to import from both server and client code.

export const ACCESS_LEVELS = ['public', 'authenticated', 'subscriber'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]

export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'loom', 'imagekit'] as const
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]

export const SUBSCRIPTION_TIERS = ['free', 'pro'] as const
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number]

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v)
}
export function isVideoProvider(v: unknown): v is VideoProvider {
  return typeof v === 'string' && (VIDEO_PROVIDERS as readonly string[]).includes(v)
}
export function isCourseStatus(v: unknown): v is CourseStatus {
  return typeof v === 'string' && (COURSE_STATUSES as readonly string[]).includes(v)
}

/** The three computed viewer buckets that drive every gated surface. */
export type Viewer = 'guest' | 'member' | 'subscriber'

export type CategoryVM = { slug: string; name: string }

/** A course as shown on the catalog grid / continue rail / related rail. */
export type CourseCardVM = {
  slug: string
  title: string
  subtitle: string | null
  coverImageUrl: string | null
  category: CategoryVM | null
  accessLevel: AccessLevel
  lessonCount: number
  durationSeconds: number
  // viewer-specific (null/false/0 for guests)
  progressPct: number | null
  completed: boolean
}

export type CourseDetailVM = CourseCardVM & {
  description: string | null
}

/** A lesson row in the curriculum list (shared between detail + player). Metadata only. */
export type LessonRowVM = {
  slug: string
  title: string
  summary: string | null
  durationSeconds: number | null
  position: number
  isPreview: boolean
  provider: VideoProvider
  // viewer-specific
  locked: boolean
  completed: boolean
  inProgress: boolean
  resumeSeconds: number
}

/** A "continue learning" item for the catalog rail. */
export type ResumeVM = {
  courseSlug: string
  courseTitle: string
  coverImageUrl: string | null
  lessonSlug: string
  lessonTitle: string
  lessonNumber: number
  lessonCount: number
  progressPct: number
  resumeSeconds: number
}

/**
 * What the player needs to render a video. The server resolves this via the
 * get_lesson_playback RPC (entitlement re-checked in the DB) and NEVER ships
 * raw provider ids / imagekit paths to the client — only a ready embed URL or
 * a short-lived signed URL.
 */
export type LessonPlayback =
  | { kind: 'embed'; provider: 'youtube' | 'vimeo' | 'loom'; embedUrl: string }
  | { kind: 'file'; provider: 'imagekit'; signedUrl: string; expiresAt: string }
