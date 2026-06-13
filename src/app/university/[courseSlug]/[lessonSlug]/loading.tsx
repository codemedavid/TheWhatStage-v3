// WhatStage University — lesson player loading skeleton.
// Mirrors the player grid (stage + sidebar) so navigation between lessons feels
// instant while the (cached) lesson content + playback resolve. role="status".

export default function LessonPlayerLoading() {
  return (
    <main role="status" aria-live="polite" aria-busy="true">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading lesson…
      </span>

      {/* sub-header */}
      <div style={{ borderBottom: '1px solid var(--uni-border)', background: 'var(--uni-bg)' }}>
        <div className="uni-wrap" style={{ display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <div className="uni-skeleton" style={{ height: 14, width: 180 }} />
        </div>
      </div>

      <div className="uni-wrap uni-player-grid" style={{ paddingTop: 20, paddingBottom: 64 }}>
        {/* player column */}
        <div style={{ minWidth: 0 }}>
          <div className="uni-skeleton" style={{ aspectRatio: '16 / 9', width: '100%', borderRadius: 14 }} />
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="uni-skeleton" style={{ height: 12, width: 220 }} />
            <div className="uni-skeleton" style={{ height: 30, width: '70%' }} />
          </div>
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'var(--uni-maxw-read)' }}>
            <div className="uni-skeleton" style={{ height: 14, width: '95%' }} />
            <div className="uni-skeleton" style={{ height: 14, width: '88%' }} />
            <div className="uni-skeleton" style={{ height: 14, width: '60%' }} />
          </div>
        </div>

        {/* sidebar */}
        <div className="uni-player-side">
          <div className="uni-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="uni-skeleton" style={{ height: 14, width: '60%' }} />
            <div className="uni-skeleton" style={{ height: 8, width: '100%', borderRadius: 999 }} />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="uni-skeleton" style={{ height: 22, width: 22, borderRadius: 999, flexShrink: 0 }} />
                <div className="uni-skeleton" style={{ height: 13, width: `${75 - i * 6}%` }} />
              </div>
            ))}
          </div>
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
