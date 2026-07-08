const MESSAGES: Record<string, string> = {
  utility_messaging_missing:
    'This page is connected, but Facebook did not grant the pages_utility_messaging permission — so sending utility-message templates to people outside the 24-hour window will fail. Reconnect and approve that permission in the dialog (Development Mode grants it to app admins/testers immediately; a Live-mode app needs App Review). Normal in-window replies are unaffected.',
}

export function WarnBanner({ code }: { code?: string }) {
  if (!code) return null
  const msg = MESSAGES[code]
  if (!msg) return null
  return (
    <div className="mb-4 rounded-md border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#92400E]">
      {msg}
    </div>
  )
}
