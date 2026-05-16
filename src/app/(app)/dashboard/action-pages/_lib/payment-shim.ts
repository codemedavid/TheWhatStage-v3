export interface CatalogPaymentConfigSlice {
  payment_method_ids?: string[]
  payment?: { enabled?: boolean; excluded_method_ids?: string[] }
}

export function migrateCatalogPaymentConfig<T extends CatalogPaymentConfigSlice>(
  config: T,
  allEnabledMethodIds: string[],
): T & { payment: { enabled: boolean; excluded_method_ids: string[] } } {
  if (config.payment && typeof config.payment.enabled === 'boolean') {
    return config as T & { payment: { enabled: boolean; excluded_method_ids: string[] } }
  }
  const include = Array.isArray(config.payment_method_ids)
    ? new Set(config.payment_method_ids)
    : null
  const excluded =
    include === null ? [] : allEnabledMethodIds.filter((id) => !include.has(id))
  const next = { ...config, payment: { enabled: true, excluded_method_ids: excluded } }
  delete (next as CatalogPaymentConfigSlice).payment_method_ids
  return next as T & { payment: { enabled: boolean; excluded_method_ids: string[] } }
}
