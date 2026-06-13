// WhatStage University — course detail loading skeleton.
// Mirrors the course hero + curriculum layout so navigation feels instant while
// the (cached) content + per-user progress overlay resolve. role="status" for SR.

export default function CourseDetailLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading course…
      </span>

      {/* HERO band */}
      <section style={{ background: 'var(--uni-bg-deep)', borderBottom: '1px solid var(--uni-border)' }}>
        <div className="uni-wrap" style={{ padding: '40px 24px 48px', display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: '60ch' }}>
            <div className="uni-skeleton" style={{ height: 14, width: 120 }} />
            <div className="uni-skeleton" style={{ height: 44, width: '85%' }} />
            <div className="uni-skeleton" style={{ height: 18, width: '70%' }} />
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <div className="uni-skeleton" style={{ height: 44, width: 160, borderRadius: 12 }} />
              <div className="uni-skeleton" style={{ height: 44, width: 120, borderRadius: 12 }} />
            </div>
          </div>
          <div className="uni-skeleton" style={{ aspectRatio: '16 / 9', width: '100%', maxWidth: 560, borderRadius: 16 }} />
        </div>
      </section>

      {/* CURRICULUM */}
      <div className="uni-wrap" style={{ padding: '40px 24px 64px' }}>
        <div className="uni-skeleton" style={{ height: 24, width: 200, marginBottom: 20 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="uni-card"
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px' }}
            >
              <div className="uni-skeleton" style={{ height: 28, width: 28, borderRadius: 999, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="uni-skeleton" style={{ height: 15, width: `${70 - i * 5}%` }} />
                <div className="uni-skeleton" style={{ height: 11, width: '30%' }} />
              </div>
              <div className="uni-skeleton" style={{ height: 12, width: 48, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
