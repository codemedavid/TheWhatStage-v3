import { GenericComingSoon } from '../shared/GenericComingSoon'
import type { KindRendererProps } from '../types'

export default function CatalogRenderer(props: KindRendererProps) {
  return <GenericComingSoon kindLabel="Catalog" {...props} />
}
