import { registerHandler } from '../dispatch'

// Stub — replaced by the Qualification kind PR.
registerHandler('qualification', (payload) => ({
  outcome: 'submitted',
  data: payload,
}))
