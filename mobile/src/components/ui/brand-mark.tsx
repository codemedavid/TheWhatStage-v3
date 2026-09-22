import { Image, type ImageStyle } from 'expo-image'
import type { StyleProp } from 'react-native'

/** Aspect ratio of assets/images/brand-mark.png (768 x 644). */
const ASPECT = 768 / 644

interface Props {
  /** Rendered width in points; height follows the mark's aspect ratio. */
  size: number
  style?: StyleProp<ImageStyle>
}

/** The WhatStage symbol on its own — no wordmark, no background. */
export function BrandMark({ size, style }: Props) {
  return (
    <Image
      source={require('@/assets/images/brand-mark.png')}
      style={[{ width: size, height: size / ASPECT }, style]}
      contentFit="contain"
      accessibilityLabel="WhatStage"
      transition={0}
    />
  )
}
