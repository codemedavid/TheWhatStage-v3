import { createProduct } from '../actions'

export default async function NewProductPage() {
  await createProduct()
  return null
}
