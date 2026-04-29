const MESSAGES: Record<string, string> = {
  denied: 'Facebook connection cancelled.',
  invalid_state: 'Authentication state expired or invalid. Please try again.',
  exchange_failed: "Couldn't complete Facebook connection. Please try again.",
  no_selection: 'Pick at least one page to save.',
  no_connection: 'No Facebook connection found. Please reconnect.',
  no_match: 'The selected page is no longer available on your Facebook account.',
  save_failed: 'Could not save the selected page(s).',
  disconnect_failed: 'Could not disconnect Facebook.',
}

export function ErrorBanner({ code, detail }: { code?: string; detail?: string }) {
  if (!code) return null
  const msg = MESSAGES[code] ?? 'Something went wrong. Please try again.'
  return (
    <div className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">
      <div>{msg}</div>
      {detail && <div className="mt-1 text-[12px] opacity-80">{detail}</div>}
    </div>
  )
}
