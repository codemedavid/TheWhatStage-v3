import { Image } from 'expo-image'
import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { avatarTint, initials } from '@/lib/format'
import { colors } from '@/theme/tokens'

interface AvatarProps {
  name: string | null | undefined
  uri?: string | null
  size?: number
  /** Emerald ring = operator has taken over / live conversation. */
  ring?: boolean
  /** Small dot at the corner (unread pulse). */
  dot?: boolean
}

function AvatarInner({ name, uri, size = 48, ring = false, dot = false }: AvatarProps) {
  const tint = avatarTint(name)
  const inner = ring ? size - 6 : size
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2 },
        ring && styles.ring,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: tint.fg, fontWeight: '700', fontSize: Math.round(inner * 0.36) }}>
            {initials(name)}
          </Text>
        </View>
      )}
      {dot && <View style={[styles.dot, { width: size * 0.26, height: size * 0.26 }]} />}
    </View>
  )
}

// One per list row, and every prop is a primitive, so the shallow check is free
// and saves re-decoding the remote image on unrelated list updates.
export const Avatar = memo(AvatarInner)

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  ring: { borderWidth: 2, borderColor: colors.accent },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    borderRadius: 999,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.card,
  },
})
