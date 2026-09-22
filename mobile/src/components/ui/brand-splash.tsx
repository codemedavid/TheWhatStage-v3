import { Image } from 'expo-image'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { BrandMark } from '@/components/ui/brand-mark'
import { colors } from '@/theme/tokens'

/** Matches the native splash icon so the hand-off has no visible jump. */
const MARK_WIDTH = 140
/** How far the mark lifts to make room for the wordmark, keeping the lockup centred. */
const LIFT = 36
/** Keep the brand on screen this long even when auth resolves instantly. */
const MIN_VISIBLE_MS = 1150
const EXIT_MS = 320

SplashScreen.setOptions({ duration: 220, fade: true })

const fadeIn = (value: Animated.Value, delay: number, duration: number) =>
  Animated.sequence([
    Animated.delay(delay),
    Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
  ])

interface Props {
  /** Flips true once auth has resolved and the first screen can be shown. */
  appReady: boolean
}

/**
 * Brand splash that takes over from the native splash screen: the mark fades
 * up out of a soft glow, lifts, and the wordmark settles underneath. It hides
 * the native splash on its first layout, so the app never flashes behind it.
 */
export function BrandSplash({ appReady }: Props) {
  const [hidden, setHidden] = useState(false)
  const [mark] = useState(() => new Animated.Value(0))
  const [lift] = useState(() => new Animated.Value(0))
  const [word] = useState(() => new Animated.Value(0))
  const [tag] = useState(() => new Animated.Value(0))
  const [exit] = useState(() => new Animated.Value(0))
  const mountedAt = useRef(0)

  useEffect(() => {
    mountedAt.current = Date.now()
    Animated.parallel([
      fadeIn(mark, 0, 520),
      Animated.sequence([
        Animated.delay(260),
        Animated.spring(lift, { toValue: 1, damping: 18, stiffness: 180, useNativeDriver: true }),
      ]),
      fadeIn(word, 360, 420),
      fadeIn(tag, 520, 420),
    ]).start()
  }, [mark, lift, word, tag])

  useEffect(() => {
    if (!appReady) return
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - mountedAt.current))
    const timer = setTimeout(() => {
      Animated.timing(exit, {
        toValue: 1,
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setHidden(true)
      })
    }, wait)
    return () => clearTimeout(timer)
  }, [appReady, exit])

  if (hidden) return null

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
        },
      ]}
      onLayout={() => {
        SplashScreen.hideAsync().catch(() => {})
      }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[
          styles.lockup,
          { transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] }) }] },
        ]}
      >
        <Animated.View
          style={[
            styles.glow,
            {
              opacity: mark.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] }),
              transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }],
            },
          ]}
        >
          <Image source={require('@/assets/images/brand-glow.png')} style={StyleSheet.absoluteFill} transition={0} />
        </Animated.View>

        <Animated.View
          style={{
            opacity: mark,
            transform: [
              { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
              { translateY: mark.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            ],
          }}
        >
          <BrandMark size={MARK_WIDTH} />
        </Animated.View>

        <View style={styles.caption}>
          <Animated.Text
            style={[
              styles.wordmark,
              {
                opacity: word,
                transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}
          >
            WhatStage
          </Animated.Text>
          <Animated.View style={{ opacity: tag }}>
            <Text style={styles.tagline}>LEADS · CONVERSION · CHATBOT</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  lockup: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: MARK_WIDTH * 2.6, height: MARK_WIDTH * 2.6 },
  // Absolute so the mark stays optically centred while the caption animates in.
  caption: { position: 'absolute', top: '100%', left: -140, right: -140, marginTop: 22, alignItems: 'center' },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6, color: colors.ink },
  tagline: { marginTop: 8, fontSize: 10, fontWeight: '700', letterSpacing: 2.4, color: colors.tertiary },
})
