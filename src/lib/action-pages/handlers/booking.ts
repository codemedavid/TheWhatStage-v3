import { registerHandler } from '../dispatch'

// Stub — replaced by the Booking kind PR.
registerHandler('booking', (payload) => ({
  outcome: 'submitted',
  data: payload,
}))
