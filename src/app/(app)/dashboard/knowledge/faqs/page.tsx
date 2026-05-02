import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchCategories, fetchFaqs } from '../_lib/queries'
import { KnowledgeTabs } from '../_components/KnowledgeTabs'
import { FaqCategoryFilter } from './_components/FaqCategoryFilter'
import { FaqList } from './_components/FaqList'

export default async function FaqsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const categoryParam =
    typeof sp.category === 'string' ? sp.category : undefined
  const q = typeof sp.q === 'string' ? sp.q : undefined

  const filter: { categoryId?: string | null; q?: string } = { q }
  if (categoryParam === 'uncategorized') filter.categoryId = null
  else if (categoryParam) filter.categoryId = categoryParam

  const [categories, faqs] = await Promise.all([
    fetchCategories(supabase, user.id),
    fetchFaqs(supabase, user.id, filter),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
          Knowledge
        </h1>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          Everything your AI assistant should know about your business.
        </p>
      </header>

      <KnowledgeTabs
        rightSlot={
          <Link
            href="/dashboard/knowledge/faqs/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#059669] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#047857]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New FAQ
          </Link>
        }
      />

      <form className="flex" method="GET" action="/dashboard/knowledge/faqs">
        {categoryParam ? (
          <input type="hidden" name="category" value={categoryParam} />
        ) : null}
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search FAQs…"
          className="h-9 w-full max-w-md rounded-md border border-[#E5E7EB] bg-white px-3 text-[13px] outline-none focus:border-[#059669]"
        />
      </form>

      <Suspense fallback={null}>
        <FaqCategoryFilter categories={categories} />
      </Suspense>

      <FaqList faqs={faqs} categories={categories} />
    </div>
  )
}
