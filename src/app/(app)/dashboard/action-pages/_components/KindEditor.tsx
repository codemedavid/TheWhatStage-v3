import type { ActionPageRow } from '../_lib/queries'
import FormEditor from '../_kinds/form/Editor'
import BookingEditor from '../_kinds/booking/Editor'
import QualificationEditor from '../_kinds/qualification/Editor'
import SalesEditor from '../_kinds/sales/Editor'
import CatalogEditor from '../_kinds/catalog/Editor'
import RealEstateEditor from '../_kinds/realestate/Editor'

export function KindEditor({ page }: { page: ActionPageRow }) {
  switch (page.kind) {
    case 'form':
      return <FormEditor page={page} />
    case 'booking':
      return <BookingEditor page={page} />
    case 'qualification':
      return <QualificationEditor page={page} />
    case 'sales':
      return <SalesEditor page={page} />
    case 'catalog':
      return <CatalogEditor page={page} />
    case 'realestate':
      return <RealEstateEditor page={page} />
  }
}
