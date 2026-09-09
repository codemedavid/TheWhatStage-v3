import { describe, expect, it } from 'vitest'
import { buildStoragePath, defaultAssetName, needsDescription, validateUploadFiles } from './upload'

const MB = 1024 * 1024

describe('validateUploadFiles', () => {
  it('accepts a mixed batch of image, video and voice files within limits', () => {
    const result = validateUploadFiles([
      { name: 'a.png', type: 'image/png', size: 2 * MB },
      { name: 'demo.mp4', type: 'video/mp4', size: 20 * MB },
      { name: 'hi.mp3', type: 'audio/mpeg', size: 1 * MB },
    ])
    expect(result).toEqual({ ok: true })
  })

  it('rejects an empty batch', () => {
    expect(validateUploadFiles([])).toEqual({ ok: false, error: 'No files selected' })
  })

  it('rejects unsupported mimes by file name', () => {
    const result = validateUploadFiles([{ name: 'clip.webm', type: 'video/webm', size: 1 * MB }])
    expect(result).toEqual({ ok: false, error: 'clip.webm is not a supported image, video or voice file' })
  })

  it('rejects files over the per-kind size cap', () => {
    const result = validateUploadFiles([{ name: 'big.mp4', type: 'video/mp4', size: 26 * MB }])
    expect(result).toEqual({ ok: false, error: 'big.mp4 is over the 25 MB limit for video' })
  })

  it('rejects images over 10 MB', () => {
    const result = validateUploadFiles([{ name: 'huge.png', type: 'image/png', size: 11 * MB }])
    expect(result).toEqual({ ok: false, error: 'huge.png is over the 10 MB limit for image' })
  })

  it('rejects empty files', () => {
    expect(validateUploadFiles([{ name: 'x.mp3', type: 'audio/mpeg', size: 0 }])).toEqual({
      ok: false,
      error: 'x.mp3 is empty',
    })
  })

  it('rejects more than 20 files at once', () => {
    const files = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.png`, type: 'image/png', size: 1 }))
    expect(validateUploadFiles(files)).toEqual({ ok: false, error: 'Upload at most 20 files at a time' })
  })
})

describe('defaultAssetName', () => {
  it('strips the extension and caps at 120 chars', () => {
    expect(defaultAssetName('Welcome Voice.mp3')).toBe('Welcome Voice')
    expect(defaultAssetName(`${'a'.repeat(200)}.mp4`)).toHaveLength(120)
  })

  it('falls back to the kind label when the name is empty', () => {
    expect(defaultAssetName('.mp3', 'audio')).toBe('Voice message')
    expect(defaultAssetName('', 'video')).toBe('Video')
    expect(defaultAssetName('', 'image')).toBe('Image')
  })
})

describe('buildStoragePath', () => {
  it('nests under user and folder with the asset id prefix and a safe file name', () => {
    expect(buildStoragePath('u1', 'f1', 'asset-9', 'My Clip (final).MP4')).toBe('u1/f1/asset-9-my-clip-final-.mp4')
  })

  it('uses the kind as file name when nothing safe remains', () => {
    expect(buildStoragePath('u1', 'f1', 'asset-9', '***', 'audio')).toBe('u1/f1/asset-9-audio')
  })
})

describe('needsDescription', () => {
  it('is true for voice and video assets without a description', () => {
    expect(needsDescription('audio/mpeg', null)).toBe(true)
    expect(needsDescription('video/mp4', '  ')).toBe(true)
    expect(needsDescription('video/mp4', 'Product walkthrough')).toBe(false)
  })

  it('is false for images', () => {
    expect(needsDescription('image/png', null)).toBe(false)
  })
})
