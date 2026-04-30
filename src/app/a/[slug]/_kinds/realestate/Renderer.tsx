import { GenericComingSoon } from '../shared/GenericComingSoon'
import type { KindRendererProps } from '../types'

export default function RealEstateRenderer(props: KindRendererProps) {
  return <GenericComingSoon kindLabel="Real Estate" {...props} />
}
