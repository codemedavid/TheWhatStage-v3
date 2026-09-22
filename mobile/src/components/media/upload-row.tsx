import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Button } from '@/components/ui/button'
import { useUploadMedia } from '@/data/media-upload'
import type { UploadedMediaAsset } from '@/lib/api'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  /** Fires once per successful upload batch; never for a cancelled picker. */
  onUploaded?: (assets: UploadedMediaAsset[]) => void
  /**
   * Raised for as long as a pick-and-upload is running. The host sheet uses it
   * to refuse dismissal: unmounting mid-upload would strand the transfer with
   * nothing left to report its result to.
   */
  onBusyChange?: (busy: boolean) => void
  /** Shown above the buttons when nothing has gone wrong yet. */
  hint?: string
  style?: StyleProp<ViewStyle>
}

/**
 * "Add to library" — pick from the camera roll or shoot a photo, upload, and
 * hand the published assets back. Dropped into any sheet that lists the media
 * library so an operator never has to leave the app for the dashboard.
 */
export function MediaUploadRow({ onUploaded, onBusyChange, hint, style }: Props) {
  const { upload, isUploading, progress, error, reset } = useUploadMedia()

  const run = async (source: 'library' | 'camera') => {
    reset()
    onBusyChange?.(true)
    try {
      // The error is surfaced through `error` below, so a rejection here is
      // already reported and only needs to stop the success path.
      const assets = await upload(source).catch(() => null)
      if (assets && assets.length > 0) onUploaded?.(assets)
    } finally {
      onBusyChange?.(false)
    }
  }

  const label =
    progress && progress.total > 1
      ? `Uploading ${progress.done + 1} of ${progress.total}…`
      : 'Uploading…'

  return (
    <View style={[styles.block, style]}>
      <View style={styles.row}>
        <Button
          label={isUploading ? label : 'Upload'}
          accessibilityLabel={isUploading ? label : 'Upload to media library'}
          variant="secondary"
          size="sm"
          loading={isUploading}
          onPress={() => void run('library')}
          icon={<Ionicons name="cloud-upload-outline" size={16} color={colors.ink} />}
          style={styles.grow}
        />
        <Button
          label="Camera"
          accessibilityLabel="Take a photo and upload it"
          variant="secondary"
          size="sm"
          disabled={isUploading}
          onPress={() => void run('camera')}
          icon={<Ionicons name="camera-outline" size={16} color={colors.ink} />}
          style={styles.grow}
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error instanceof Error ? error.message : 'Upload failed'}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.md,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  hint: { ...type.caption, textAlign: 'center' },
  error: { ...type.small, color: colors.danger, textAlign: 'center' },
})
