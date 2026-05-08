import { registerHandler, type ParsedSubmission } from '../dispatch'

export function parseRealestateSubmission(
  payload: Record<string, unknown>,
): ParsedSubmission {
  return { outcome: 'inquiry_submitted', data: payload }
}

registerHandler('realestate', parseRealestateSubmission)
