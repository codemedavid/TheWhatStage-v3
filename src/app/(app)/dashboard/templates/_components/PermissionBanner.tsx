'use client'

import { S } from './tokens'

/**
 * Shown once when a submit returns a permission error (Meta code 200 — the
 * Facebook app lacks pages_utility_messaging). Single source of the permission
 * copy, surfaced above the list rather than per-row.
 */
export function PermissionBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        background: S.warnSoft,
        color: S.warn,
        border: `1px solid #FCD34D`,
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 12,
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>Your Facebook app needs the <code>pages_utility_messaging</code> permission.</strong>{' '}
        Meta didn&apos;t review these templates — request the permission in App Review on the Meta App
        Dashboard, then re-submit. Affected templates stay in <em>Draft</em>.
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ border: 'none', background: 'transparent', color: S.warn, fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
      >
        ×
      </button>
    </div>
  )
}
