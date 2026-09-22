import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius } from '@/theme/tokens'

export interface Segment<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  segments: Segment<T>[]
  compact?: boolean
}

/** iOS-style sliding segmented control (List / Board switcher). */
export function Segmented<T extends string>({ value, onChange, segments, compact }: Props<T>) {
  const [width, setWidth] = useState(0)
  const index = Math.max(0, segments.findIndex((s) => s.value === value))
  const [x] = useState(() => new Animated.Value(0))
  const segW = width / Math.max(1, segments.length)

  useEffect(() => {
    Animated.spring(x, { toValue: index * segW, useNativeDriver: true, damping: 20, stiffness: 260 }).start()
  }, [index, segW, x])

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 4)

  return (
    <View style={[styles.track, compact && styles.trackCompact]} onLayout={onLayout}>
      {width > 0 && (
        <Animated.View
          style={[styles.thumb, { width: segW, transform: [{ translateX: x }] }, compact && { top: 2, bottom: 2 }]}
        />
      )}
      {segments.map((s) => {
        const active = s.value === value
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) Haptics.selectionAsync().catch(() => {})
              onChange(s.value)
            }}
            style={[styles.seg, compact && styles.segCompact]}
          >
            {s.icon}
            <Text style={[styles.label, active && styles.labelActive, compact && { fontSize: 12 }]}>{s.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.pill,
    padding: 2,
    position: 'relative',
  },
  trackCompact: { padding: 2 },
  thumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  seg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  segCompact: { paddingVertical: 5 },
  label: { fontSize: 13, fontWeight: '600', color: colors.tertiary },
  labelActive: { color: colors.ink },
})
