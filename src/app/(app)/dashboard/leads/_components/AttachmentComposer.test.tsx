import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// The composer only needs the send action; stub it so importing the server-action
// module doesn't drag in crypto/supabase env requirements. We assert on the upload
// fetch, which short-circuits before this ever runs.
vi.mock('../actions/messenger', () => ({
  sendAttachmentAsOperator: vi.fn().mockResolvedValue({ ok: true }),
}))

import { AttachmentComposer } from './AttachmentComposer'

beforeAll(() => {
  // jsdom lacks object-URL APIs the AudioTrimmer uses on mount.
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock')
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const noop = () => {}

function dropFile(target: Element, file: File) {
  fireEvent.drop(target, { dataTransfer: { files: [file], items: [], types: ['Files'] } })
}

describe('AttachmentComposer drag-and-drop', () => {
  it('uploads a file dropped onto the upload area', async () => {
    // 413 short-circuits before the server-action send, isolating the drop wiring.
    const fetchMock = vi.fn().mockResolvedValue({ status: 413 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<AttachmentComposer leadId="lead-1" onSent={noop} onError={noop} onClose={noop} />)

    const dropZone = screen.getByRole('button', { name: /choose or drop a file/i })
    const pdf = new File(['%PDF-1.4'], 'menu.pdf', { type: 'application/pdf' })
    dropFile(dropZone, pdf)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messenger/operator-upload')
  })

  it('routes a dropped audio file to the trimmer instead of uploading immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 413 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<AttachmentComposer leadId="lead-1" onSent={noop} onError={noop} onClose={noop} />)

    const dropZone = screen.getByRole('button', { name: /choose or drop a file/i })
    // No MIME type, audio extension only — the iPadOS case.
    const mp3 = new File(['ID3'], 'voice.mp3', { type: '' })
    dropFile(dropZone, mp3)

    // Trimmer UI appears (Trim & send / Preview); no upload fetch fired yet.
    await waitFor(() => expect(screen.getByText(/trim & send/i)).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
