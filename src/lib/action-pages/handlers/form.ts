import { registerHandler } from '../dispatch'

// Stub — replaced by the Form kind PR.
registerHandler('form', (payload) => ({
  outcome: 'submitted',
  data: payload,
}))
