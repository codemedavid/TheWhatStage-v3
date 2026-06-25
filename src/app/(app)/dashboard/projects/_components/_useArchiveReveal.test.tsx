import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArchiveRevealProvider, useArchiveReveal } from './_useArchiveReveal'

// Probe exposes the context's state + toggle as plain DOM so the test can assert
// on the reveal flipping WITHOUT any router navigation (the bug being fixed:
// the old URL round-trip never re-rendered the board).
function Probe() {
  const { showArchived, toggleArchived } = useArchiveReveal()
  return <button onClick={toggleArchived}>{showArchived ? 'on' : 'off'}</button>
}

describe('useArchiveReveal', () => {
  it('hides archived cards by default', () => {
    render(
      <ArchiveRevealProvider>
        <Probe />
      </ArchiveRevealProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('off')
  })

  it('honors the initial value so ?archived=1 deep-links still reveal on load', () => {
    render(
      <ArchiveRevealProvider initial>
        <Probe />
      </ArchiveRevealProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('on')
  })

  it('toggles the reveal instantly on the client (no navigation needed)', () => {
    render(
      <ArchiveRevealProvider>
        <Probe />
      </ArchiveRevealProvider>,
    )
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(btn.textContent).toBe('on')
    fireEvent.click(btn)
    expect(btn.textContent).toBe('off')
  })

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ArchiveRevealProvider/)
    spy.mockRestore()
  })
})
