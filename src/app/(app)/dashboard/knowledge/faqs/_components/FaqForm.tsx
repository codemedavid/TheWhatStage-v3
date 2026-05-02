import Link from 'next/link'
import type { CategoryRow, FaqRow } from '../../_lib/queries'
import {
  createFaqForm,
  updateFaqForm,
  deleteFaqForm,
} from '../../actions/faqs'

export function FaqForm({
  faq,
  categories,
}: {
  faq?: FaqRow
  categories: CategoryRow[]
}) {
  const isEdit = Boolean(faq)
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/dashboard/knowledge/faqs"
          className="inline-flex items-center gap-1 text-[12.5px] text-[#6B7280] hover:text-[#111827]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to FAQs
        </Link>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#111827]">
          {isEdit ? 'Edit FAQ' : 'New FAQ'}
        </h1>
      </header>

      <form
        action={isEdit ? updateFaqForm : createFaqForm}
        className="space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-5"
      >
        {isEdit && <input type="hidden" name="id" value={faq!.id} />}

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium text-[#374151]">
            Question
          </label>
          <input
            name="question"
            required
            maxLength={300}
            defaultValue={faq?.question ?? ''}
            placeholder="What does this product do?"
            className="h-10 w-full rounded-md border border-[#E5E7EB] bg-white px-3 text-[14px] outline-none focus:border-[#059669]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium text-[#374151]">
            Answer
          </label>
          <textarea
            name="answer"
            rows={8}
            maxLength={10000}
            defaultValue={faq?.answer ?? ''}
            placeholder="Write the answer in plain text. Markdown supported in future."
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#059669]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[12.5px] font-medium text-[#374151]">
            Category
          </label>
          <select
            name="categoryId"
            defaultValue={faq?.category_id ?? ''}
            className="h-9 rounded-md border border-[#E5E7EB] bg-white px-2 text-[13px] outline-none focus:border-[#059669]"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-[13px] text-[#374151]">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={faq?.is_published ?? true}
            />
            Published
          </label>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md bg-[#059669] px-4 text-[13px] font-medium text-white hover:bg-[#047857]"
          >
            {isEdit ? 'Save changes' : 'Create FAQ'}
          </button>
          <Link
            href="/dashboard/knowledge/faqs"
            className="inline-flex h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3 text-[13px] font-medium text-[#374151] hover:bg-[#F9FAFB]"
          >
            Cancel
          </Link>
        </div>
      </form>

      {isEdit && (
        <form
          action={deleteFaqForm}
          className="rounded-xl border border-[#FEE2E2] bg-[#FEF2F2] p-4"
        >
          <input type="hidden" name="id" value={faq!.id} />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-[#991B1B]">
                Delete this FAQ
              </p>
              <p className="text-[12.5px] text-[#B91C1C]">
                This cannot be undone.
              </p>
            </div>
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-[#DC2626] px-3 text-[13px] font-medium text-white hover:bg-[#B91C1C]"
            >
              Delete
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
