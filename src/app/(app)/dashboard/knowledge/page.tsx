import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchCategories,
  fetchDocumentsList,
  fetchTags,
} from './_lib/queries'
import { NewDocumentButton } from './_components/NewDocumentButton'
import { CategoryManager } from './_components/CategoryManager'
import { CategoryFilter } from './_components/CategoryFilter'
import { TagManager } from './_components/TagManager'
import { TagFilter } from './_components/TagFilter'
import { DocumentList } from './_components/DocumentList'
import { KnowledgeTabs } from './_components/KnowledgeTabs'

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const categoryParam =
    typeof sp.category === 'string' ? sp.category : undefined
  const tagParam = typeof sp.tag === 'string' ? sp.tag : undefined
  const q = typeof sp.q === 'string' ? sp.q : undefined

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

      <SearchBar
        defaultValue={q ?? ''}
        category={categoryParam}
        tag={tagParam}
      />

      <Suspense fallback={<KnowledgeBodyFallback />}>
        <KnowledgeBody
          categoryParam={categoryParam}
          tagParam={tagParam}
          q={q}
        />
      </Suspense>
    </div>
  )
}

async function KnowledgeBody({
  categoryParam,
  tagParam,
  q,
}: {
  categoryParam?: string
  tagParam?: string
  q?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const filter: { categoryId?: string | null; q?: string; tagId?: string } = { q }
  if (categoryParam === 'uncategorized') filter.categoryId = null
  else if (categoryParam) filter.categoryId = categoryParam
  if (tagParam) filter.tagId = tagParam

  const [categories, tags, documents] = await Promise.all([
    fetchCategories(supabase, user.id),
    fetchTags(supabase, user.id),
    fetchDocumentsList(supabase, user.id, filter),
  ])

  return (
    <>
      <KnowledgeTabs
        rightSlot={
          <>
            <TagManager tags={tags} />
            <CategoryManager categories={categories} />
            <NewDocumentButton
              categoryId={
                categoryParam && categoryParam !== 'uncategorized'
                  ? categoryParam
                  : null
              }
            />
          </>
        }
      />

      <Suspense fallback={null}>
        <CategoryFilter categories={categories} />
      </Suspense>
      <Suspense fallback={null}>
        <TagFilter tags={tags} />
      </Suspense>

      <DocumentList
        documents={documents}
        categories={categories}
        tags={tags}
      />

      {documents.length === 0 && categories.length === 0 && (
        <p className="text-[12.5px] text-[#6B7280]">
          Tip: create a category first via{' '}
          <Link href="#" className="text-[#059669]">
            Manage categories
          </Link>{' '}
          to organize as you write.
        </p>
      )}

      <p className="text-[11.5px] text-[#9aa0a6]">
        Drag a document onto a category pill to move it.
      </p>
    </>
  )
}

function KnowledgeBodyFallback() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded bg-[#EEF0F3]" />
        <div className="h-8 w-24 rounded bg-[#EEF0F3]" />
        <div className="ml-auto h-8 w-32 rounded bg-[#E5E7EB]" />
      </div>
      <div className="space-y-2 pt-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-14 rounded-lg border border-[#E5E7EB] bg-white"
          />
        ))}
      </div>
    </div>
  )
}

function SearchBar({
  defaultValue,
  category,
  tag,
}: {
  defaultValue: string
  category?: string
  tag?: string
}) {
  return (
    <form className="flex" method="GET" action="/dashboard/knowledge">
      {category ? (
        <input type="hidden" name="category" value={category} />
      ) : null}
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder="Search documents…"
        className="h-9 w-full max-w-md rounded-md border border-[#E5E7EB] bg-white px-3 text-[13px] outline-none focus:border-[#059669]"
      />
    </form>
  )
}
