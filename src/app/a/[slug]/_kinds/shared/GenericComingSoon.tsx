import type { KindRendererProps } from '../types'

export function GenericComingSoon({
  kindLabel,
  page,
  claims,
  rawToken,
}: KindRendererProps & { kindLabel: string }) {
  return (
    <div className="space-y-5">
      {page.description && (
        <header>
          <p className="mt-1 text-[14px] text-[#6B7280]">{page.description}</p>
        </header>
      )}
      <div className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-8 text-center text-[13px] text-[#6B7280]">
        The interactive {kindLabel.toLowerCase()} experience is being built.
      </div>
      <form action="/api/action-pages/submit" method="post" className="space-y-3">
        <input type="hidden" name="slug" value={page.slug} />
        {claims && rawToken && (
          <>
            <input type="hidden" name="p" value={claims.psid} />
            <input type="hidden" name="g" value={claims.pageId} />
            <input type="hidden" name="e" value={claims.exp} />
            <input type="hidden" name="t" value={rawToken} />
          </>
        )}
        <button
          type="submit"
          className="w-full rounded-md bg-[#059669] px-3 py-2 text-[14px] font-semibold text-white hover:bg-[#047857]"
        >
          Submit (test)
        </button>
      </form>
    </div>
  )
}
