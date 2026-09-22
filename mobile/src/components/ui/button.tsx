import * as Haptics from 'expo-haptics'
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native'
import { colors, radius, spacing } from '@/theme/tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  style?: StyleProp<ViewStyle>
  haptic?: boolean
  /** Defaults to `label`; set it when `loading` hides the label from readers. */
  accessibilityLabel?: string
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
  haptic = true,
  accessibilityLabel,
}: ButtonProps) {
  const isOff = disabled || loading
  const bg = {
    primary: colors.accent,
    secondary: colors.card,
    ghost: 'transparent',
    danger: colors.dangerLight,
  }[variant]
  const fg = {
    primary: '#fff',
    secondary: colors.ink,
    ghost: colors.accent,
    danger: colors.danger,
  }[variant]
  const pad = { sm: [6, 12], md: [11, 18], lg: [14, 22] }[size]
  const font = { sm: 13, md: 15, lg: 16 }[size]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isOff, busy: loading }}
      disabled={isOff}
      onPress={() => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress()
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          paddingVertical: pad[0],
          paddingHorizontal: pad[1],
          opacity: isOff ? 0.5 : pressed ? 0.85 : 1,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ color: fg, fontWeight: '600', fontSize: font }}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
  },
})
