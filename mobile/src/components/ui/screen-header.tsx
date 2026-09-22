import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, spacing, type } from '@/theme/tokens'

interface Props {
  title?: string
  /** Large title style for tab roots; compact for pushed screens. */
  large?: boolean
  back?: boolean
  right?: React.ReactNode
  /** Replaces the title area (e.g. avatar + name in the chat header). */
  center?: React.ReactNode
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  bordered?: boolean
}

export function ScreenHeader({ title, large, back, right, center, children, style, bordered = true }: Props) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + (large ? 6 : 4) }, bordered && styles.bordered, style]}>
      <View style={styles.row}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        )}
        {center ?? (
          <Text style={[large ? type.display : type.heading, { flex: 1 }]} numberOfLines={1}>
            {title}
          </Text>
        )}
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {children}
    </View>
  )
}

export function IconButton({
  name,
  onPress,
  label,
  tint = colors.ink,
  filled,
}: {
  name: keyof typeof Ionicons.glyphMap
  onPress: () => void
  label: string
  tint?: string
  filled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, filled && styles.iconBtnFilled, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={name} size={21} color={tint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.page, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  bordered: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  back: { marginLeft: -8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  iconBtnFilled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
})
