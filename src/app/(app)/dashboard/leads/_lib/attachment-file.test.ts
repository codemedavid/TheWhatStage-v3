import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ACCEPT, attachmentTypeFromFile, isAudioFile } from './attachment-file'

const f = (name: string, type: string) => ({ name, type })

describe('ATTACHMENT_ACCEPT', () => {
  it('keeps the broad MIME wildcards', () => {
    expect(ATTACHMENT_ACCEPT).toContain('audio/*')
    expect(ATTACHMENT_ACCEPT).toContain('image/*')
    expect(ATTACHMENT_ACCEPT).toContain('application/pdf')
  })

  it('lists explicit audio extensions so iPadOS enables mp3/m4a in the Files picker', () => {
    // The audio/* wildcard alone greys these out on iOS/iPadOS.
    expect(ATTACHMENT_ACCEPT).toContain('.mp3')
    expect(ATTACHMENT_ACCEPT).toContain('.m4a')
    expect(ATTACHMENT_ACCEPT).toContain('.wav')
    expect(ATTACHMENT_ACCEPT).toContain('.aac')
  })
})

describe('isAudioFile', () => {
  it('detects audio by MIME type', () => {
    expect(isAudioFile(f('clip.mp3', 'audio/mpeg'))).toBe(true)
    expect(isAudioFile(f('voice.m4a', 'audio/mp4'))).toBe(true)
  })

  it('detects audio by extension when the MIME type is missing (iPadOS Files pick)', () => {
    expect(isAudioFile(f('clip.mp3', ''))).toBe(true)
    expect(isAudioFile(f('voice.m4a', 'application/octet-stream'))).toBe(true)
    expect(isAudioFile(f('song.WAV', ''))).toBe(true) // case-insensitive
  })

  it('does not treat images, video, or documents as audio', () => {
    expect(isAudioFile(f('photo.jpg', 'image/jpeg'))).toBe(false)
    expect(isAudioFile(f('movie.mp4', 'video/mp4'))).toBe(false)
    expect(isAudioFile(f('doc.pdf', 'application/pdf'))).toBe(false)
    expect(isAudioFile(f('noext', ''))).toBe(false)
  })
})

describe('attachmentTypeFromFile', () => {
  it('maps by MIME type when present', () => {
    expect(attachmentTypeFromFile(f('a.png', 'image/png'))).toBe('image')
    expect(attachmentTypeFromFile(f('a.mp4', 'video/mp4'))).toBe('video')
    expect(attachmentTypeFromFile(f('a.mp3', 'audio/mpeg'))).toBe('audio')
    expect(attachmentTypeFromFile(f('a.pdf', 'application/pdf'))).toBe('file')
  })

  it('falls back to the extension when the MIME type is empty or generic', () => {
    expect(attachmentTypeFromFile(f('a.mp3', ''))).toBe('audio')
    expect(attachmentTypeFromFile(f('a.m4a', 'application/octet-stream'))).toBe('audio')
    expect(attachmentTypeFromFile(f('a.png', ''))).toBe('image')
    expect(attachmentTypeFromFile(f('a.mov', ''))).toBe('video')
  })

  it('defaults to file for unknown shapes', () => {
    expect(attachmentTypeFromFile(f('a.xyz', ''))).toBe('file')
    expect(attachmentTypeFromFile(f('noext', ''))).toBe('file')
  })
})
