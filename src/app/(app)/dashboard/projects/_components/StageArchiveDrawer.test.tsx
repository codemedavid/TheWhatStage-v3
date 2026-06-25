import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StageArchiveDrawer } from './StageArchiveDrawer'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow } from '@/lib/projects/types'

const unarchiveProject = vi.fn()
vi.mock('../actions/projects', () => ({
  unarchiveProject: (...args: unknown[]) => unarchiveProject(...args),
}))

function card(over: Partial<ProjectCardRow>): ProjectCardRow {
  return {
    id: 'p', user_id: 'u', lead_id: 'l', origin_submission_id: null,
    stage_id: 's1', title: 't', description: null, value: null,
    currency: 'PHP', ai_instructions: null, notes: null, position: 0,
    archived_at: '2026-06-10', created_at: '2026-06-01', updated_at: '2026-06-01',
    lead_name: null, lead_email: null, lead_phone: null, lead_company: null,
    lead_picture_url: null, stage_name: null, stage_kind: 'open',
    origin_submission_kind: null, unread_count: 0, missed_count: 0,
    is_archived: true,
    ...over,
  }
}

const stage: ProjectStageRow = {
  id: 's1', name: 'Proposal', description: null, position: 0,
  is_default: false, kind: 'open', color: null,
}

describe('StageArchiveDrawer', () => {
  beforeEach(() => {
    unarchiveProject.mockReset().mockResolvedValue(undefined)
  })

  it('lists each archived project with its title and customer', () => {
    const archived = [
      card({ id: 'a', title: 'Big Deal', lead_name: 'Ada Lovelace', value: 5000, currency: 'PHP' }),
      card({ id: 'b', title: 'Small Deal', lead_name: 'Bob' }),
    ]
    render(<StageArchiveDrawer stage={stage} archived={archived} onClose={() => {}} onOpen={() => {}} />)
    expect(screen.getByText('Big Deal')).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Small Deal')).toBeTruthy()
  })

  it('names the stage in the panel heading', () => {
    render(<StageArchiveDrawer stage={stage} archived={[]} onClose={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/Proposal/)).toBeTruthy()
  })

  it('shows an empty state when the stage has no archived projects', () => {
    render(<StageArchiveDrawer stage={stage} archived={[]} onClose={() => {}} onOpen={() => {}} />)
    expect(screen.getByText(/no archived projects/i)).toBeTruthy()
  })

  it('unarchives a project when its Unarchive button is clicked', async () => {
    const archived = [card({ id: 'a', title: 'Big Deal' })]
    render(<StageArchiveDrawer stage={stage} archived={archived} onClose={() => {}} onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /unarchive/i }))
    await waitFor(() => expect(unarchiveProject).toHaveBeenCalledWith('a'))
  })

  it('opens a project when its row is clicked', () => {
    const onOpen = vi.fn()
    const archived = [card({ id: 'a', title: 'Big Deal' })]
    render(<StageArchiveDrawer stage={stage} archived={archived} onClose={() => {}} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Big Deal'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<StageArchiveDrawer stage={stage} archived={[]} onClose={onClose} onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
