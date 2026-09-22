import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native'
import { MediaUploadRow } from '@/components/media/upload-row'
import { Button } from '@/components/ui/button'
import { EmptyState, Pill, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { mediaKindFromMime, useMediaAssets, useMediaThumb, type MediaAsset, type MediaKind } from '@/data/media'
import { one } from '@/data/types'
import { api } from '@/lib/api'
import { describeSendError } from '@/lib/send-error'
import { colors, radius, spacing, type } from '@/theme/tokens'

const COLUMNS = 3

const assetKey = (a: MediaAsset) => a.id
const COLUMN_WRAPPER = { gap: 8 }
const GRID_CONTENT = { gap: 8, paddingBottom: 96 }
const KIND_ICON: Record<MediaKind, keyof typeof Ionicons.glyphMap> = {
  image: 'image-outline',
  video: 'videocam-outline',
  audio: 'mic-outline',
}
const KIND_FILTERS: { value: MediaKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Photos' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Voice' },
]

interface Props {
  visible: boolean
  onClose: () => void
  leadId: string
  onSent?: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

interface TileProps {
  asset: MediaAsset
  selected: boolean
  /** Takes the asset so the grid can pass one stable handler per tile. */
  onPress: (asset: MediaAsset) => void
}

function MediaTileInner({ asset, selected, onPress }: TileProps) {
  const kind = mediaKindFromMime(asset.mime_type) ?? 'image'
  const thumb = useMediaThumb(asset)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset.name}
      accessibilityState={{ selected }}
      onPress={() => onPress(asset)}
      style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && { opacity: 0.85 }]}
    >
      {kind === 'image' && thumb.data ? (
        <Image source={{ uri: thumb.data }} style={styles.thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon]}>
          <Ionicons name={KIND_ICON[kind]} size={28} color={colors.accent} />
        </View>
      )}
      <View style={styles.tileFoot}>
        <Text style={styles.tileName} numberOfLines={1}>
          {asset.name}
        </Text>
      </View>
      {selected && (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
      )}
    </Pressable>
  )
}

// Every tile runs its own signed-thumbnail query, so an unmemoised grid
// re-mounted all of them on each keystroke in the search box.
const MediaTile = memo(MediaTileInner)

/** Library picker for the composer "+" menu: pick one asset, send it as an attachment. */
export function MediaSheet({ visible, onClose, leadId, onSent }: Props) {
  const assets = useMediaAssets(visible)
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selection is held by id and looked up in the *unfiltered* list, so a
  // just-uploaded asset can be selected before the grid has it and a selection
  // survives the operator changing the search or the kind filter.
  const selected = (assets.data ?? []).find((a) => a.id === selectedId) ?? null

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (assets.data ?? []).filter((a) => {
      if (kind !== 'all' && mediaKindFromMime(a.mime_type) !== kind) return false
      if (!q) return true
      const folder = one(a.media_folders)?.name ?? ''
      return `${a.name} ${a.description ?? ''} ${folder}`.toLowerCase().includes(q)
    })
  }, [assets.data, kind, search])

  const pick = useCallback((asset: MediaAsset) => {
    Haptics.selectionAsync().catch(() => {})
    setSelectedId((cur) => (cur === asset.id ? null : asset.id))
    setError(null)
  }, [])

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaAsset>) => (
      <MediaTile asset={item} selected={selectedId === item.id} onPress={pick} />
    ),
    [selectedId, pick],
  )

  const close = () => {
    // Dismissing now would unmount the uploader and strand the transfer.
    if (uploading) return
    setSelectedId(null)
    setError(null)
    setSending(false)
    onClose()
  }

  const send = async () => {
    if (!selected || sending) return
    setSending(true)
    setError(null)
    const res = await api.sendMedia(leadId, selected.id)
    setSending(false)
    if (!res.ok) {
      setError(describeSendError(res.error))
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onSent?.()
    close()
  }

  const selectedKind = selected ? (mediaKindFromMime(selected.mime_type) ?? 'image') : null

  return (
    <Sheet visible={visible} onClose={close} title="Media library" subtitle="Send a photo, video, or voice note" height={0.82}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search media"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search media"
        />
      </View>
      <View style={styles.pills}>
        {KIND_FILTERS.map((f) => (
          <Pill key={f.value} label={f.label} active={kind === f.value} onPress={() => setKind(f.value)} />
        ))}
      </View>
      <MediaUploadRow
        style={{ marginBottom: spacing.md }}
        onBusyChange={setUploading}
        hint="Added to your media library, ready to send or reuse."
        onUploaded={(uploaded) => {
          const first = uploaded[0]
          if (first) setSelectedId(first.id)
        }}
      />

      {assets.isLoading ? (
        <View style={styles.grid}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} height={120} style={{ width: '31%' }} />
          ))}
        </View>
      ) : assets.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load media" body={describeSendError(assets.error.message)} />
      ) : (
        <FlatList
          data={rows}
          key={COLUMNS}
          numColumns={COLUMNS}
          keyExtractor={assetKey}
          keyboardShouldPersistTaps="handled"
          columnWrapperStyle={COLUMN_WRAPPER}
          contentContainerStyle={GRID_CONTENT}
          ListEmptyComponent={
            <EmptyState
              icon="images-outline"
              title={search || kind !== 'all' ? 'No matches' : 'No media yet'}
              body={search || kind !== 'all' ? 'Try another filter or keyword.' : 'Upload a photo or video above, or add voice notes in the dashboard.'}
            />
          }
          renderItem={renderItem}
        />
      )}

      {selected && (
        <View style={styles.footer}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.bodyStrong} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={type.small}>
              {selectedKind === 'audio' ? 'Voice note' : selectedKind === 'video' ? 'Video' : 'Photo'} · {formatSize(selected.byte_size)}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
          <Button label="Send" onPress={send} loading={sending} icon={<Ionicons name="paper-plane" size={15} color="#fff" />} />
        </View>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.borderSubtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  pills: { flexDirection: 'row', gap: 8, paddingVertical: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flex: 1,
    maxWidth: '32%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
  },
  tileSelected: { borderColor: colors.accent },
  thumb: { width: '100%', aspectRatio: 1, backgroundColor: colors.borderSubtle },
  thumbIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentLight },
  tileFoot: { paddingHorizontal: 8, paddingVertical: 6 },
  tileName: { fontSize: 12, fontWeight: '600', color: colors.body },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  error: { ...type.small, color: colors.danger },
})
