import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EchoTemplateField } from './EchoTemplateField'

describe('EchoTemplateField', () => {
  it('renders the textarea with the default value', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{fb.name}}!"
        rows={3}
      />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(ta.value).toBe('Hi {{fb.name}}!')
    expect(ta.name).toBe('notification_text')
  })

  it('inserts the picked variable at the cursor position', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi !"
        rows={3}
      />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole('button', { name: /Facebook profile name/i }))
    expect(ta.value).toContain('{{fb.name}}')
  })

  it('renders the live preview using sample data', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{fb.name || customer.name}}!"
        rows={3}
      />,
    )
    expect(screen.getByTestId('echo-preview').textContent).toContain('Hi Maria Santos!')
  })

  it('flags unknown tokens with a warning', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{customer.adress}}!"
        rows={3}
      />,
    )
    expect(screen.getByTestId('echo-warnings').textContent).toMatch(/customer\.adress/)
  })

  it('collapses picker behind a button in compact mode', () => {
    render(
      <EchoTemplateField
        name="notify_text"
        kind="booking"
        customKeys={[]}
        defaultValue=""
        rows={2}
        compact
      />,
    )
    expect(screen.queryByRole('button', { name: /Facebook profile name/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }))
    expect(screen.getByRole('button', { name: /Facebook profile name/i })).toBeTruthy()
  })
})
