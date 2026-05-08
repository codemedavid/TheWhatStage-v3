import { PaymentMethodsClient } from './_components/PaymentMethodsClient'
import { loadPaymentMethods } from './actions'

export const dynamic = 'force-dynamic'

export default async function PaymentMethodsPage() {
  const methods = await loadPaymentMethods()
  return <PaymentMethodsClient initial={methods} />
}
