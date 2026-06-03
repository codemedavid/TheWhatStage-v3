// WhatStage University — catalog loading skeleton (Screen 1, §3.3).
// Hero copy is static; the grid renders 6 shimmer cards. role="status" for SR.

export default function UniversityCatalogLoading() {
  const inner: React.CSSProperties = {
    maxWidth: 'var(--uni-maxw)',
    margin: '0 auto',
    padding: '0 24px',
    width: '100%',
  }

  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading courses…
      </span>

      {/* HERO band */}
      <section style={{ background: 'var(--uni-bg-deep)', borderBottom: '1px solid var(--uni-border)' }}>
        <div style={{ ...inner, padding: '72px 24px 56px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="uni-eyebrow">✦ WhatStage University</span>
          <h1
            className="uni-serif"
            style={{
              fontWeight: 400,
              fontSize: 'clamp(38px, 6vw, 66px)',
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              color: 'var(--uni-ink)',
              maxWidth: '16ch',
            }}
          >
            Learn to turn every conversation into a customer.
          </h1>
          <div className="uni-skeleton" style={{ height: 18, width: '40ch', maxWidth: '90%' }} />
        </div>
      </section>

      {/* FILTER BAR placeholder */}
      <div style={{ borderBottom: '1px solid var(--uni-border)', opacity: 0.6 }}>
        <div style={{ ...inner, padding: '14px 24px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="uni-skeleton" style={{ height: 32, width: 96, borderRadius: 999 }} />
          ))}
          <div className="uni-skeleton" style={{ height: 36, width: 220, marginLeft: 'auto', borderRadius: 12 }} />
        </div>
      </div>

      {/* GRID */}
      <div style={{ ...inner, padding: '40px 24px 8px' }}>
        <div className="uni-skeleton" style={{ height: 26, width: 200, marginBottom: 18 }} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 20,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="uni-card" style={{ overflow: 'hidden' }}>
              <div className="uni-skeleton" style={{ aspectRatio: '16 / 9', borderRadius: 0 }} />
              <div style={{ padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="uni-skeleton" style={{ height: 12, width: '40%' }} />
                <div className="uni-skeleton" style={{ height: 16, width: '85%' }} />
                <div className="uni-skeleton" style={{ height: 12, width: '55%' }} />
              </div>
              <div className="uni-skeleton" style={{ height: 42, borderRadius: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
