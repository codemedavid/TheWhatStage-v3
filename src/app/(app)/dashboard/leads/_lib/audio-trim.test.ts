import { describe, expect, it } from 'vitest'
import { encodeWav, sliceChannels } from './audio-trim'

describe('encodeWav', () => {
  it('writes a valid 44-byte WAV header for mono PCM', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const blob = encodeWav([samples], 8000)
    expect(blob.type).toBe('audio/wav')

    const view = new DataView(await blob.arrayBuffer())
    const tag = (offset: number) =>
      String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))

    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(36)).toBe('data')
    expect(view.getUint16(22, true)).toBe(1) // channel count
    expect(view.getUint32(24, true)).toBe(8000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2) // data byte length
  })

  it('interleaves stereo channels frame-by-frame', async () => {
    const left = new Float32Array([1, 0])
    const right = new Float32Array([-1, 0])
    const blob = encodeWav([left, right], 44100)
    const view = new DataView(await blob.arrayBuffer())

    // Frame 0: left then right.
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(view.getUint16(32, true)).toBe(4) // block align = 2ch * 2 bytes
  })
})

describe('sliceChannels', () => {
  function fakeBuffer(channelData: number[][], sampleRate: number): AudioBuffer {
    const channels = channelData.map((d) => Float32Array.from(d))
    return {
      sampleRate,
      length: channels[0].length,
      numberOfChannels: channels.length,
      getChannelData: (i: number) => channels[i],
    } as unknown as AudioBuffer
  }

  it('returns only frames inside [startSec, endSec]', () => {
    const buffer = fakeBuffer([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], 10) // 1s, 10 frames
    const [ch] = sliceChannels(buffer, 0.2, 0.5) // frames 2..5
    expect(Array.from(ch)).toEqual([2, 3, 4])
  })

  it('clamps a range that runs past the buffer', () => {
    const buffer = fakeBuffer([[0, 1, 2, 3]], 4)
    const [ch] = sliceChannels(buffer, 0.5, 5)
    expect(Array.from(ch)).toEqual([2, 3])
  })

  it('preserves channel count', () => {
    const buffer = fakeBuffer([[0, 1, 2, 3], [4, 5, 6, 7]], 4)
    const result = sliceChannels(buffer, 0, 0.5)
    expect(result).toHaveLength(2)
    expect(Array.from(result[1])).toEqual([4, 5])
  })
})
