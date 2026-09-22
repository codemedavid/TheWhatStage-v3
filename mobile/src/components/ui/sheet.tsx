import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardView } from '@/components/ui/keyboard-view'
import { colors, radius, shadow, spacing, type } from '@/theme/tokens'

interface SheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  /** 'auto' hugs content; a number is a fixed fraction of the screen height. */
  height?: 'auto' | number
  children: ReactNode
  /** Right-side header slot (e.g. a "Done" button). */
  action?: ReactNode
}

const SCREEN_H = Dimensions.get('window').height

/**
 * Lightweight bottom sheet on top of RN Modal — no native deps, so it works
 * in Expo Go. Slides up over a dimmed backdrop; tap outside to dismiss.
 */
export function Sheet({ visible, onClose, title, subtitle, height = 'auto', children, action }: SheetProps) {
  const insets = useSafeAreaInsets()
  const [translate] = useState(() => new Animated.Value(SCREEN_H))
  const [fade] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (!visible) return
    translate.setValue(SCREEN_H)
    fade.setValue(0)
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translate, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 240,
        mass: 0.8,
      }),
    ]).start()
  }, [visible, translate, fade])

  const close = () => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(translate, { toValue: SCREEN_H, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose())
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <KeyboardView style={styles.container}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={styles.fill} onPress={close} accessibilityLabel="Close sheet" />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            shadow.sheet,
            {
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              transform: [{ translateY: translate }],
            },
            typeof height === 'number' ? { height: SCREEN_H * height } : { maxHeight: SCREEN_H * 0.88 },
          ]}
        >
          <View style={styles.grabber} />
          {(title || action) && (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title ? <Text style={type.title}>{title}</Text> : null}
                {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
              </View>
              {action}
            </View>
          )}
          {children}
        </Animated.View>
      </KeyboardView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The backdrop is absolutely positioned, so the sheet is the only flow child
  // and must be pinned to the bottom edge explicitly.
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.elevated,
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.faint,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
})
