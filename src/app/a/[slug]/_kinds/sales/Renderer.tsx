import { GenericComingSoon } from '../shared/GenericComingSoon'
import type { KindRendererProps } from '../types'

export default function SalesRenderer(props: KindRendererProps) {
  return <GenericComingSoon kindLabel="Sales" {...props} />
}
