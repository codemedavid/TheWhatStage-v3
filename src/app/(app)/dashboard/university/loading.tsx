// List skeleton for the superadmin course list (CMS screen A).
// Renders the hero + stat strip + table chrome statically while the RSC fetches.
export default function Loading() {
  return (
    <div data-actions-list>
      <div className="apl-wrap" aria-busy="true" role="status">
        <div className="apl-hero">
          <div className="apl-hero-meta">
            <div className="apl-eyebrow">
              <span style={{ display: 'inline-block', width: 13, height: 13, borderRadius: 4, background: 'var(--ws-surface-3)' }} />
              <span style={{ display: 'inline-block', width: 150, height: 11, borderRadius: 4, background: 'var(--ws-surface-3)' }} />
            </div>
            <h1>
              <span style={{ display: 'inline-block', width: 220, height: 30, borderRadius: 8, background: 'var(--ws-surface-3)' }} />
            </h1>
            <p>
              <span style={{ display: 'inline-block', width: 'min(420px, 80%)', height: 13, borderRadius: 6, background: 'var(--ws-surface-3)' }} />
            </p>
          </div>
        </div>

        <div className="apl-stats">
          {[0, 1, 2].map((i) => (
            <div className="apl-stat" key={i}>
              <div className="apl-stat-label">
                <span style={{ display: 'inline-block', width: 70, height: 10, borderRadius: 4, background: 'var(--ws-surface-3)' }} />
              </div>
              <div className="apl-stat-value">
                <span style={{ display: 'inline-block', width: 40, height: 24, borderRadius: 6, background: 'var(--ws-surface-3)' }} />
              </div>
            </div>
          ))}
        </div>

        <div className="apl-table" aria-hidden="true">
          <div className="apl-th uni-courses-th">
            <div>Course</div>
            <div>Access</div>
            <div>Status</div>
            <div>Lessons</div>
            <div>Updated</div>
            <div />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="apl-tr uni-courses-tr" key={i} style={{ cursor: 'default' }}>
              <div className="apl-col-title">
                <span style={{ width: 56, height: 36, borderRadius: 8, background: 'var(--ws-surface-3)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', width: '60%', height: 14, borderRadius: 5, background: 'var(--ws-surface-3)', marginBottom: 6 }} />
                  <span style={{ display: 'block', width: '40%', height: 11, borderRadius: 4, background: 'var(--ws-surface-3)' }} />
                </div>
              </div>
              <div><span style={{ display: 'inline-block', width: 64, height: 22, borderRadius: 999, background: 'var(--ws-surface-3)' }} /></div>
              <div><span style={{ display: 'inline-block', width: 56, height: 22, borderRadius: 999, background: 'var(--ws-surface-3)' }} /></div>
              <div><span style={{ display: 'inline-block', width: 24, height: 13, borderRadius: 4, background: 'var(--ws-surface-3)' }} /></div>
              <div><span style={{ display: 'inline-block', width: 60, height: 13, borderRadius: 4, background: 'var(--ws-surface-3)' }} /></div>
              <div />
            </div>
          ))}
        </div>

        <span className="sr-only">Loading courses…</span>
      </div>

      <style>{`
        [data-actions-list] .uni-courses-th,
        [data-actions-list] .uni-courses-tr {
          grid-template-columns: 2.6fr 1fr 1fr 0.8fr 1fr 56px;
        }
      `}</style>
    </div>
  )
}
