import type { ActionPageOption, ActionPageRow, PipelineStageOption } from '../_lib/queries'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import FormEditor from '../_kinds/form/Editor'
import BookingEditor from '../_kinds/booking/Editor'
import QualificationEditor from '../_kinds/qualification/Editor'
import SalesEditor from '../_kinds/sales/Editor'
import CatalogEditor from '../_kinds/catalog/Editor'
import RealEstateEditor from '../_kinds/realestate/Editor'

export function KindEditor({
  page,
  stages = [],
  actionPages = [],
  paymentMethods = [],
}: {
  page: ActionPageRow
  stages?: PipelineStageOption[]
  actionPages?: ActionPageOption[]
  paymentMethods?: PaymentMethod[]
}) {
  switch (page.kind) {
    case 'form':
      return <FormEditor page={page} />
    case 'booking':
      return <BookingEditor page={page} />
    case 'qualification':
      return <QualificationEditor page={page} stages={stages} actionPages={actionPages} />
    case 'sales':
      return <SalesEditor page={page} paymentMethods={paymentMethods} />
    case 'catalog':
      return <CatalogEditor page={page} paymentMethods={paymentMethods} />
    case 'realestate':
      return <RealEstateEditor page={page} />
  }
}
