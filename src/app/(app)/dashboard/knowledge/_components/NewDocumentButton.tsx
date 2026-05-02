import { createDocumentForm } from '../actions/documents'

export function NewDocumentButton({ categoryId }: { categoryId?: string | null }) {
  return (
    <form action={createDocumentForm}>
      <input type="hidden" name="categoryId" value={categoryId ?? ''} />
      <button
        type="submit"
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#059669] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#047857] disabled:opacity-60"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        New document
      </button>
    </form>
  )
}
