// Single source of truth for template meta_status badge label + colors, so the
// Templates list, list rows, editor, and status spine can't drift on the
// palette. Colors preserved verbatim from the original TemplatesClient.

import type { TemplateMetaStatus } from './types'

export interface StatusBadgeStyle {
  label: string
  bg: string
  color: string
}

export function templateStatusBadge(status: TemplateMetaStatus): StatusBadgeStyle {
  switch (status) {
    case 'approved':
      return { label: 'Approved', bg: '#DCFCE7', color: '#166534' }
    case 'pending':
      return { label: 'Pending review', bg: '#FEF3C7', color: '#92400E' }
    case 'rejected':
      return { label: 'Rejected', bg: '#FEE2E2', color: '#991B1B' }
    case 'disabled':
      return { label: 'Disabled', bg: '#F3F4F6', color: '#6B7280' }
    default:
      return { label: 'Draft', bg: '#F3F4F6', color: '#374151' }
  }
}

/** Short label for the status spine pills. */
export function statusPillLabel(status: TemplateMetaStatus | 'all'): string {
  switch (status) {
    case 'all':
      return 'All'
    case 'approved':
      return 'Approved'
    case 'pending':
      return 'Pending'
    case 'rejected':
      return 'Rejected'
    case 'disabled':
      return 'Disabled'
    default:
      return 'Draft'
  }
}
