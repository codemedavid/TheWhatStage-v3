import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth/get-session'
import { loadLessonContext } from '@/lib/university/data'
import { getLessonPlayback } from '@/lib/university/playback'
import { getViewer, isSubscriber } from '@/lib/university/access'
import { LessonPlayer } from './_components/LessonPlayer'
import { PlayerSidebar } from './_components/PlayerSidebar'
import { LockScreen } from './_components/LockScreen'

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}

export default async function LessonPlayerPage({
  params,
}: {
  params: Promise<{ courseSlug: string; lessonSlug: string }>
}) {
  const { courseSlug, lessonSlug } = await params
  const session = await getSession()

  // metadata only — NEVER sources (§6).
  const ctx = await loadLessonContext(session, courseSlug, lessonSlug)
  if (!ctx) notFound()

  const { course, lesson, lessonId, lessons, coursePct, entitlement, prevSlug, nextSlug } = ctx
  const viewer = getViewer(session)
  const signedIn = viewer !== 'guest'
  const subscriber = isSubscriber(session)
  const previewLesson = lessons.find((l) => l.isPreview) ?? null
  const completedCount = lessons.filter((l) => l.completed).length
  const lessonNumber = lesson.position + 1

  const thisUrl = `/university/${courseSlug}/${lessonSlug}`
  const nextHref = nextSlug ? `/university/${courseSlug}/${nextSlug}` : null
  const prevHref = prevSlug ? `/university/${courseSlug}/${prevSlug}` : null

  // entitlement chip for the sidebar footer
  const entitlementChip: 'pro' | 'upsell' | null =
    course.accessLevel === 'subscriber'
      ? subscriber
        ? 'pro'
        : 'upsell'
      : null

  // §6: STOP before the RPC if the viewer isn't entitled.
  const playback = entitlement.allowed ? await getLessonPlayback(lessonId) : null

  // canTrack = signed-in AND entitled.
  const canTrack = !!session && entitlement.allowed

  const subHeader = (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'var(--uni-bg)',
        borderBottom: '1px solid var(--uni-border)',
      }}
    >
      <div className="uni-wrap" style={{ display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
        <Link href={`/university/${courseSlug}`} className="uni-focus" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: 'var(--uni-ink-2)', fontWeight: 500, minWidth: 0 }}>
          <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.title}</span>
        </Link>
        {entitlementChip === 'pro' ? (
          <span className="uni-badge uni-badge-pro" style={{ marginLeft: 'auto', flexShrink: 0 }}>
            ✦ Pro
          </span>
        ) : null}
      </div>
    </div>
  )

  return (
    <main>
      {subHeader}
      <div className="uni-wrap uni-player-grid" style={{ paddingTop: 20, paddingBottom: 64 }}>
        {/* player column */}
        <div style={{ minWidth: 0 }}>
          {entitlement.allowed && playback ? (
            <LessonPlayer
              playback={playback}
              resumeSeconds={lesson.resumeSeconds}
              lessonId={lessonId}
              canTrack={canTrack}
              alreadyComplete={lesson.completed}
              nextHref={nextHref}
              finishHref={`/university/${courseSlug}`}
            />
          ) : !entitlement.allowed ? (
            <LockScreen
              reason={entitlement.reason === 'needs_subscription' ? 'needs_subscription' : 'needs_login'}
              courseSlug={courseSlug}
              previewLessonSlug={previewLesson?.slug ?? null}
              nextUrl={thisUrl}
            />
          ) : (
            // entitled but the DB returned no source (unset / signing failed) —
            // a config/transient problem, NOT a paywall.
            <LockScreen reason="unavailable" courseSlug={courseSlug} previewLessonSlug={previewLesson?.slug ?? null} nextUrl={thisUrl} />
          )}

          {/* lesson heading */}
          <div style={{ marginTop: 20 }}>
            <p className="uni-eyebrow">
              {course.category?.name ? `${course.category.name} · ` : ''}
              Lesson {lessonNumber} of {lessons.length} · {formatDuration(lesson.durationSeconds)}
            </p>
            <h1 className="uni-serif" style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.012em', color: 'var(--uni-ink)', margin: '8px 0 0' }}>
              {lesson.title}
            </h1>
          </div>

          {/* prose */}
          {lesson.summary ? (
            <section style={{ maxWidth: 'var(--uni-maxw-read)', marginTop: 24 }}>
              <h2 className="uni-eyebrow" style={{ marginBottom: 10 }}>
                About this lesson
              </h2>
              <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--uni-ink-2)', whiteSpace: 'pre-wrap' }}>
                {lesson.summary}
              </div>
            </section>
          ) : null}

          {/* footer prev/next nav */}
          <nav style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--uni-border)' }}>
            {prevHref ? (
              <Link href={prevHref} className="uni-btn uni-btn-ghost uni-focus">
                <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
                Previous
              </Link>
            ) : (
              <span />
            )}
            {nextHref ? (
              <Link href={nextHref} className="uni-btn uni-btn-secondary uni-focus" style={{ marginLeft: 'auto' }}>
                Next lesson
                <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            ) : (
              <Link href={`/university/${courseSlug}`} className="uni-btn uni-btn-secondary uni-focus" style={{ marginLeft: 'auto' }}>
                Finish course
                <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            )}
          </nav>
        </div>

        {/* sidebar: desktop right column + mobile lessons disclosure.
            One mount; the component shows the right surface per breakpoint. On
            mobile, flex order floats the disclosure above the stage. */}
        <div className="uni-player-side">
          <PlayerSidebar
            courseSlug={courseSlug}
            courseTitle={course.title}
            lessons={lessons}
            activeLessonSlug={lessonSlug}
            coursePct={coursePct}
            completedCount={completedCount}
            entitlementChip={entitlementChip}
            courseAccessLevel={course.accessLevel}
            viewerSignedIn={signedIn}
          />
        </div>
      </div>

      <style>{`
        .uni-player-grid { display: flex; flex-direction: column; gap: 16px; }
        .uni-player-side { order: -1; }
        @media (min-width: 1024px) {
          .uni-player-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 32px; align-items: start; }
          .uni-player-side { order: 0; }
        }
      `}</style>
    </main>
  )
}
