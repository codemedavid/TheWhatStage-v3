import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  validateOperatorFile,
  uploadOperatorAttachment,
  MAX_UPLOAD_BYTES,
} from './operator-upload-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fileOf(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  // jsdom derives size from contents; override so we can test the size gate
  // without allocating huge buffers.
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('validateOperatorFile', () => {
  it('rejects an empty file', () => {
    const result = validateOperatorFile(fileOf('voice.wav', 'audio/wav', 0))
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/empty/i) })
  })

  it('rejects a file over the 25 MB limit', () => {
    const result = validateOperatorFile(fileOf('big.wav', 'audio/wav', MAX_UPLOAD_BYTES + 1))
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/25 MB/i) })
  })

  it('accepts a 40-second-sized voice clip well under the limit', () => {
    // ~4 MB WAV — would 413 through the Vercel function, but direct upload is fine.
    const result = validateOperatorFile(fileOf('voice.wav', 'audio/wav', 4 * 1024 * 1024))
    expect(result).toEqual({ ok: true, attachmentType: 'audio' })
  })

  it('classifies audio with an empty MIME via its extension (iPadOS Files pick)', () => {
    const result = validateOperatorFile(fileOf('voice.m4a', '', 1024))
    expect(result).toEqual({ ok: true, attachmentType: 'audio' })
  })

  it('accepts a PDF as a file attachment', () => {
    const result = validateOperatorFile(fileOf('menu.pdf', 'application/pdf', 1024))
    expect(result).toEqual({ ok: true, attachmentType: 'file' })
  })

  it('rejects an unsupported type', () => {
    const result = validateOperatorFile(fileOf('malware.exe', 'application/octet-stream', 1024))
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/unsupported/i) })
  })
})

describe('uploadOperatorAttachment', () => {
  it('returns a validation error without hitting the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadOperatorAttachment(fileOf('big.wav', 'audio/wav', MAX_UPLOAD_BYTES + 1))

    expect(result).toEqual({ error: expect.stringMatching(/25 MB/i) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches signed auth then uploads bytes straight to ImageKit', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (typeof url === 'string' && url.includes('/api/messenger/imagekit-auth')) {
        return {
          ok: true,
          json: async () => ({
            token: 'tok',
            expire: 1700000000,
            signature: 'sig',
            publicKey: 'public_abc',
            folder: '/operator-sends/user-1',
          }),
        } as Response
      }
      // ImageKit upload endpoint
      return {
        ok: true,
        json: async () => ({ url: 'https://ik.imagekit.io/x/voice.wav', fileId: 'f1' }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadOperatorAttachment(fileOf('voice.wav', 'audio/wav', 4 * 1024 * 1024))

    expect(result).toEqual({
      url: 'https://ik.imagekit.io/x/voice.wav',
      attachmentType: 'audio',
      name: 'voice.wav',
    })
    // No bytes ever transit our own API: the second call goes to ImageKit directly.
    const uploadCall = fetchMock.mock.calls[1]
    expect(uploadCall[0]).toBe('https://upload.imagekit.io/api/v1/files/upload')
    const form = uploadCall[1]?.body as FormData
    expect(form.get('signature')).toBe('sig')
    expect(form.get('token')).toBe('tok')
    expect(form.get('folder')).toBe('/operator-sends/user-1')
  })

  it('surfaces an ImageKit error message', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/messenger/imagekit-auth')) {
        return {
          ok: true,
          json: async () => ({ token: 't', expire: 1, signature: 's', publicKey: 'p', folder: '/f' }),
        } as Response
      }
      return { ok: false, status: 400, json: async () => ({ message: 'Your account is suspended' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadOperatorAttachment(fileOf('voice.wav', 'audio/wav', 1024))

    expect(result).toEqual({ error: 'Your account is suspended' })
  })

  it('returns a clear error when auth fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadOperatorAttachment(fileOf('voice.wav', 'audio/wav', 1024))

    expect(result).toEqual({ error: expect.stringMatching(/auth failed/i) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
