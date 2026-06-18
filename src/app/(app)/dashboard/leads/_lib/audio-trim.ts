/**
 * Client-side audio trimming. Decodes an uploaded audio file, slices it to the
 * requested [startSec, endSec] window, and re-encodes the selection as a 16-bit
 * PCM WAV file. WAV keeps the implementation dependency-free (no mp3 encoder) and
 * audio/wav is in the media-assets bucket allowlist.
 */

const WAV_MIME = 'audio/wav'

/** Build a 16-bit PCM WAV Blob from raw channel data. Pure — unit-testable. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length
  const frameCount = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const dataLength = frameCount * blockAlign
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format: PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][frame]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: WAV_MIME })
}

/** Slice each channel of an AudioBuffer to [startSec, endSec]. Pure. */
export function sliceChannels(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): Float32Array[] {
  const sampleRate = buffer.sampleRate
  const startFrame = Math.max(0, Math.floor(startSec * sampleRate))
  const endFrame = Math.min(buffer.length, Math.ceil(endSec * sampleRate))
  const length = Math.max(0, endFrame - startFrame)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch).slice(startFrame, startFrame + length))
  }
  return channels
}

/**
 * Average multi-channel audio down to a single mono channel. Pure. Halves (or
 * better) the encoded size of a voice clip, which keeps trimmed uploads under
 * proxy/tunnel body limits. A single channel is returned unchanged.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array[] {
  if (channels.length <= 1) return channels
  const frameCount = channels[0]?.length ?? 0
  const mono = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    for (let ch = 0; ch < channels.length; ch++) sum += channels[ch][frame] ?? 0
    mono[frame] = sum / channels.length
  }
  return [mono]
}

/**
 * Decode `file`, trim to [startSec, endSec], and return a new WAV File. Browser
 * only — uses Web Audio API to decode. The output name reuses the source name
 * with a `.wav` extension.
 */
export async function trimAudioFile(
  file: File,
  startSec: number,
  endSec: number,
): Promise<File> {
  const AudioCtx =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) throw new Error('Audio trimming is not supported in this browser')

  const ctx = new AudioCtx()
  try {
    const arrayBuffer = await file.arrayBuffer()
    const decoded = await ctx.decodeAudioData(arrayBuffer)
    const channels = sliceChannels(decoded, startSec, endSec)
    if ((channels[0]?.length ?? 0) === 0) {
      throw new Error('Selected range is empty')
    }
    // Voice clips don't need stereo — mono roughly halves the WAV payload so
    // trimmed uploads stay under proxy/tunnel request-body limits.
    const blob = encodeWav(downmixToMono(channels), decoded.sampleRate)
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'audio'
    return new File([blob], `${baseName}.wav`, { type: WAV_MIME })
  } finally {
    void ctx.close()
  }
}
