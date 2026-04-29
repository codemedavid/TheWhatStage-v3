const MESSAGES: Record<string, string> = {
  denied: 'Facebook connection cancelled.',
  invalid_state: 'Authentication state expired or invalid. Please try again.',
  exchange_failed: "Couldn't complete Facebook connection. Please try again.",
}

export function ErrorBanner({ code }: { code?: string }) {
  if (!code) return null
  const msg = MESSAGES[code] ?? 'Something went wrong. Please try again.'
  return (
    <div className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">
      {msg}
    </div>
  )
}
