import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button } from '@/components/ui/button'
import { MediaUploadRow } from '@/components/media/upload-row'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { mediaKindFromMime, useMediaAssets, useMediaThumb, type MediaAsset } from '@/data/media'
import { isSendableUrl } from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'

const COLUMNS = 3

/** What a card's image is: a library asset, a pasted link, or nothing. */
export interface CardImage {
  image_asset_id?: string
  image_url?: string
}

interface Props {
  visible: boolean
  value: CardImage
  onClose: () => void
  onPick: (image: CardImage) => void
}

/**
 * Chooses a card's image. A library asset is stored by id and signed fresh on
 * every send, because a signed storage URL expires long before a saved message
 * stops being used; a pasted link is stored and sent verbatim.
 */
export function CardImageSheet({ visible, value, onClose, onPick }: Props) {
  // Held out here, above the per-opening mount below, so a dismissal cannot
  // unmount the uploader while its transfer is still running.
  const [uploading, setUploading] = useState(false)
  return (
    <Sheet
      visible={visible}
      onClose={uploading ? () => {} : onClose}
      title="Card image"
      subtitle="From your library, or a link"
      height={0.8}
    >
      {/* Mounted per opening, so the link field starts from the card's current
          image without an effect copying props into state. */}
      {visible ? (
        <ImagePicker value={value} onClose={onClose} onPick={onPick} onBusyChange={setUploading} />
      ) : null}
    </Sheet>
  )
}

function ImagePicker({
  value,
  onClose,
  onPick,
  onBusyChange,
}: Omit<Props, 'visible'> & { onBusyChange: (busy: boolean) => void }) {
  const assets = useMediaAssets(true)
  const [link, setLink] = useState(value.image_url ?? '')
  const [error, setError] = useState<string | null>(null)

  const images = (assets.data ?? []).filter((asset) => mediaKindFromMime(asset.mime_type) === 'image')

  const useLink = () => {
    if (!isSendableUrl(link)) {
      setError('Enter an image link starting with http:// or https://.')
      return
    }
    onPick({ image_url: link.trim() })
    onClose()
  }

  return (
    <>
      <FlatList
        data={images}
        numColumns={COLUMNS}
        keyExtractor={(asset) => asset.id}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ gap: 8, paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.linkBlock}>
            <Text style={type.label}>IMAGE LINK</Text>
            <View style={styles.linkRow}>
              <TextInput
                style={styles.input}
                value={link}
                onChangeText={(text) => {
                  setLink(text)
                  setError(null)
                }}
                placeholder="https://"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                inputMode="url"
                accessibilityLabel="Image link"
              />
              <Button label="Use" onPress={useLink} disabled={!link.trim()} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={type.label}>OR FROM YOUR LIBRARY</Text>
            {/* Uploading here picks the new image straight away — the operator
                came to this sheet to choose one, not to manage a library. */}
            <MediaUploadRow
              onBusyChange={onBusyChange}
              hint="Photos you upload are added to your media library."
              onUploaded={(uploaded) => {
                const image = uploaded.find((asset) => mediaKindFromMime(asset.mime_type) === 'image')
                if (!image) return
                onPick({ image_asset_id: image.id })
                onClose()
              }}
            />
          </View>
        }
        ListEmptyComponent={
          assets.isLoading ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Skeleton height={92} />
              <Skeleton height={92} />
              <Skeleton height={92} />
            </View>
          ) : (
            <EmptyState
              icon="images-outline"
              title="No photos yet"
              body="Upload one above, or add photos to your media library in the dashboard."
            />
          )
        }
        renderItem={({ item }) => (
          <AssetTile
            asset={item}
            selected={item.id === value.image_asset_id}
            onPress={() => {
              onPick({ image_asset_id: item.id })
              onClose()
            }}
          />
        )}
      />
      {value.image_asset_id || value.image_url ? (
        <Button
          label="Remove image"
          variant="danger"
          onPress={() => {
            onPick({})
            onClose()
          }}
        />
      ) : null}
    </>
  )
}

function AssetTile({
  asset,
  selected,
  onPress,
}: {
  asset: MediaAsset
  selected: boolean
  onPress: () => void
}) {
  const thumb = useMediaThumb(asset)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, selected && styles.tileOn, pressed && { opacity: 0.85 }]}
    >
      {thumb.data ? (
        <Image source={{ uri: thumb.data }} style={styles.thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Ionicons name="image-outline" size={24} color={colors.accent} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {asset.name}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  linkBlock: { gap: 8, paddingBottom: spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  tile: {
    flex: 1 / COLUMNS,
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tileOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.borderSubtle },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 11, color: colors.tertiary },
  error: { ...type.small, color: colors.danger },
})
