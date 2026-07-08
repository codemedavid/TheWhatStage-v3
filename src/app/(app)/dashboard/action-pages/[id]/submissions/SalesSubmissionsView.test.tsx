import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SalesSubmissionsView, { type SalesSubmissionRow } from './SalesSubmissionsView'

function makeRow(overrides: Partial<SalesSubmissionRow> = {}): SalesSubmissionRow {
  return {
    id: 's1',
    outcome: null,
    data: {},
    meta: null,
    created_at: new Date().toISOString(),
    lead_id: 'lead-1',
    lead: {
      id: 'lead-1',
      name: 'Maria Santos',
      email: null,
      phone: null,
      picture_url: null,
      psid: null,
      fb_page_id: null,
    },
    source_action_page: null,
    payment: null,
    project: null,
    ...overrides,
  }
}

function renderView(rows: SalesSubmissionRow[]) {
  return render(
    <SalesSubmissionsView
      pageId="page-1"
      pageTitle="Launch offer"
      pageStatus="published"
      submissions={rows}
    />,
  )
}

describe('SalesSubmissionsView — create project action', () => {
  it('renders a "Create project" trigger for a submission linked to a lead with no project yet', () => {
    renderView([makeRow()])
    expect(screen.getByRole('button', { name: 'Create project' })).toBeTruthy()
  })

  it('shows the existing project stage as a linked badge instead of the create trigger', () => {
    renderView([
      makeRow({
        project: {
          id: 'proj-1',
          stageName: 'Scoping',
          stageKind: 'open',
          unreadCount: 0,
          missedCount: 0,
        },
      }),
    ])
    expect(screen.getByRole('link', { name: /Scoping/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull()
  })

  it('omits the project action entirely when the submission has no linked lead', () => {
    renderView([makeRow({ lead_id: null, lead: null })])
    expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Scoping|Won|Lost/ })).toBeNull()
  })

  it('surfaces the project action inside the submission detail drawer', () => {
    renderView([makeRow()])
    fireEvent.click(screen.getByText('Maria Santos'))
    const drawer = screen.getByRole('complementary')
    expect(within(drawer).getByRole('heading', { name: 'Project' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Create project' })).toBeTruthy()
  })
})
