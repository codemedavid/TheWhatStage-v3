export type AccountField =
  | 'current_password'
  | 'new_password'
  | 'confirm_password'
  | 'email'
  | 'general'

export type AccountFormState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string; field?: AccountField }

export const ACCOUNT_FORM_IDLE: AccountFormState = { status: 'idle' }
