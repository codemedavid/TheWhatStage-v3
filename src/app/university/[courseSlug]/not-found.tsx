import Link from 'next/link'

// Editorial 404 for a missing / unpublished course. The public university
// layout already wraps this in [data-university-root] + the top bar.
export default function CourseNotFound() {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
      }}
    >
      <div
        className="uni-card"
        style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: '40px 32px' }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'var(--uni-surface-2)',
            color: 'var(--uni-ink-3)',
            margin: '0 auto 18px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width={26}
            height={26}
            stroke="currentColor"
            strokeWidth={1.75}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
            <path d="M4 5.5v15" />
          </svg>
        </span>
        <p className="uni-eyebrow" style={{ marginBottom: 10 }}>
          404 · Course
        </p>
        <h1 className="uni-serif" style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.018em', color: 'var(--uni-ink)', margin: 0 }}>
          We couldn&rsquo;t find that course.
        </h1>
        <p style={{ marginTop: 12, marginBottom: 26, fontSize: 15, lineHeight: 1.6, color: 'var(--uni-ink-3)' }}>
          It may have been unpublished or moved. The rest of the library is still here.
        </p>
        <Link href="/university" className="uni-btn uni-btn-primary uni-focus">
          Browse all courses
          <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </main>
  )
}
