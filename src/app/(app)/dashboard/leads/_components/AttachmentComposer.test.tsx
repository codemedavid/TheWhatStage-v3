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
  it('uploads a file dropped onto the upload area straight to ImageKit', async () => {
    // Direct-upload flow: first call mints the signature from our API, second
    // sends the bytes to ImageKit (never through our serverless body cap).
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/messenger/imagekit-auth')) {
        return {
          ok: true,
          json: async () => ({ token: 't', expire: 1, signature: 's', publicKey: 'p', folder: '/f' }),
        } as Response
      }
      return { ok: true, json: async () => ({ url: 'https://ik/menu.pdf' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AttachmentComposer leadId="lead-1" onSent={noop} onError={noop} onClose={noop} />)

    const dropZone = screen.getByRole('button', { name: /choose or drop a file/i })
    const pdf = new File(['%PDF-1.4'], 'menu.pdf', { type: 'application/pdf' })
    dropFile(dropZone, pdf)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messenger/imagekit-auth')
    expect(fetchMock.mock.calls[1][0]).toBe('https://upload.imagekit.io/api/v1/files/upload')
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
