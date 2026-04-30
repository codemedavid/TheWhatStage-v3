import FormRenderer from '../_kinds/form/Renderer'
import BookingRenderer from '../_kinds/booking/Renderer'
import QualificationRenderer from '../_kinds/qualification/Renderer'
import SalesRenderer from '../_kinds/sales/Renderer'
import CatalogRenderer from '../_kinds/catalog/Renderer'
import RealEstateRenderer from '../_kinds/realestate/Renderer'
import type { KindRendererProps } from '../_kinds/types'

export function KindRenderer(props: KindRendererProps) {
  switch (props.page.kind) {
    case 'form':
      return <FormRenderer {...props} />
    case 'booking':
      return <BookingRenderer {...props} />
    case 'qualification':
      return <QualificationRenderer {...props} />
    case 'sales':
      return <SalesRenderer {...props} />
    case 'catalog':
      return <CatalogRenderer {...props} />
    case 'realestate':
      return <RealEstateRenderer {...props} />
  }
}
