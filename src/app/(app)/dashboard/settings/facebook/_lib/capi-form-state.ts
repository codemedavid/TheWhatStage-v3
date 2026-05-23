export type CapiFormState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string; field?: 'dataset' | 'token' | 'page' | 'general' }

export const CAPI_FORM_IDLE: CapiFormState = { status: 'idle' }
