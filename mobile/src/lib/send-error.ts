// Operator-facing copy for send failures. Mirrors
// src/app/(app)/dashboard/leads/_lib/send-error.ts in the web app; keep the two in sync.

const FRIENDLY: Record<string, string> = {
  // Legacy: kept for message rows written before sends fell back to an
  // untagged retry. The live code now reports the window itself instead.
  'policy_blocked:human_agent_unapproved':
    "Can't send: this Facebook Page isn't approved for the Human Agent messaging window. Reply from the Page inbox, or request Human Agent access from Meta.",
  'policy_blocked:window':
    "Can't send: Meta closed this conversation's 24-hour reply window. Wait for the customer to message again, or reply from the Page inbox.",
  'policy_blocked:optin': "Can't send: this customer hasn't opted in to marketing messages.",
  'policy_blocked:otn':
    "Can't send: the one-time notification token has already been used or expired.",
  'policy_blocked:marketing_blocked':
    "Can't send: marketing messages are blocked for this conversation.",
  'policy_blocked:rate_limited':
    "Can't send right now: Messenger is rate-limiting this Page. Try again shortly.",
  network_unreachable:
    "Can't reach the WhatStage server. Check your connection or the API URL in settings.",
  media_not_found: 'That media file is no longer in your library.',
  media_unsupported: 'That file type cannot be sent on Messenger.',
  media_sign_failed: "Couldn't prepare the file for sending. Try again.",
  http_401: 'Your session expired. Sign in again.',
  http_403: 'Your account is not active.',
}

export function describeSendError(code: string): string {
  if (FRIENDLY[code]) return FRIENDLY[code]
  if (code.startsWith('policy_blocked:')) {
    return `Send blocked: ${code.slice('policy_blocked:'.length).replace(/_/g, ' ')}`
  }
  return `Send failed: ${code}`
}
