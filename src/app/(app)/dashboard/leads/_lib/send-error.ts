// Maps the machine-readable send-failure codes persisted on messenger_messages
// (and returned by the operator send actions) to operator-facing copy. Keep the
// raw code recoverable in the fallback so unmapped reasons still say something.

const FRIENDLY: Record<string, string> = {
  'policy_blocked:human_agent_unapproved':
    "Can't send: this Facebook Page isn't approved for the Human Agent messaging window. Reply from the Page inbox, or request Human Agent access from Meta.",
  'policy_blocked:window':
    "Can't send: outside Messenger's 24-hour reply window and no valid message tag applies.",
  'policy_blocked:optin':
    "Can't send: this customer hasn't opted in to marketing messages.",
  'policy_blocked:otn':
    "Can't send: the one-time notification token has already been used or expired.",
  'policy_blocked:marketing_blocked':
    "Can't send: marketing messages are blocked for this conversation.",
  'policy_blocked:rate_limited':
    "Can't send right now: Messenger is rate-limiting this Page. Try again shortly.",
}

export function describeSendError(code: string): string {
  if (FRIENDLY[code]) return FRIENDLY[code]
  // Unmapped policy blocks: strip the prefix for a slightly cleaner read.
  if (code.startsWith('policy_blocked:')) {
    return `Send blocked: ${code.slice('policy_blocked:'.length).replace(/_/g, ' ')}`
  }
  return `Send failed: ${code}`
}
