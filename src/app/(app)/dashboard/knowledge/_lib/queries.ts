import type { SupabaseClient } from '@supabase/supabase-js'

export type CategoryRow = {
  id: string
  name: string
  color: string | null
  position: number
  created_at: string
  updated_at: string
}

export type TagRow = {
  id: string
  name: string
  color: string | null
  created_at: string
  updated_at: string
}

export type DocumentListRow = {
  id: string
  title: string
  category_id: string | null
  has_unsaved_changes: boolean
  version: number
  is_pinned: boolean
  pinned_at: string | null
  published_at: string | null
  updated_at: string
  created_at: string
  tag_ids: string[]
}

export type DocumentRow = Omit<DocumentListRow, 'tag_ids'> & {
  content_json: unknown
  content_html: string | null
  content_text: string | null
  draft_json: unknown
  draft_html: string | null
  draft_text: string | null
  embedding_status: 'pending' | 'indexed' | 'stale'
  embedded_at: string | null
  tag_ids: string[]
}

export async function fetchCategories(
  supabase: SupabaseClient,
  userId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from('knowledge_categories')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CategoryRow[]
}

export async function fetchTags(
  supabase: SupabaseClient,
  userId: string,
): Promise<TagRow[]> {
  const { data, error } = await supabase
    .from('knowledge_tags')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as TagRow[]
}

type DocSelectRow = {
  id: string
  title: string
  category_id: string | null
  has_unsaved_changes: boolean
  version: number
  is_pinned: boolean
  pinned_at: string | null
  published_at: string | null
  updated_at: string
  created_at: string
  knowledge_document_tags: { tag_id: string }[] | null
}

function flattenTags(d: DocSelectRow): DocumentListRow {
  return {
    id: d.id,
    title: d.title,
    category_id: d.category_id,
    has_unsaved_changes: d.has_unsaved_changes,
    version: d.version,
    is_pinned: d.is_pinned,
    pinned_at: d.pinned_at,
    published_at: d.published_at,
    updated_at: d.updated_at,
    created_at: d.created_at,
    tag_ids: (d.knowledge_document_tags ?? []).map((t) => t.tag_id),
  }
}

export async function fetchDocumentsList(
  supabase: SupabaseClient,
  userId: string,
  opts: { categoryId?: string | null; q?: string; tagId?: string } = {},
): Promise<DocumentListRow[]> {
  let query = supabase
    .from('knowledge_documents')
    .select(
      'id, title, category_id, has_unsaved_changes, version, is_pinned, pinned_at, published_at, updated_at, created_at, knowledge_document_tags(tag_id)',
    )
    .eq('user_id', userId)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })

  if (opts.categoryId === null) {
    query = query.is('category_id', null)
  } else if (typeof opts.categoryId === 'string') {
    query = query.eq('category_id', opts.categoryId)
  }
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`
    query = query.or(`title.ilike.${term},content_text.ilike.${term}`)
  }

  const { data, error } = await query
  if (error) throw error
  let rows = ((data ?? []) as unknown as DocSelectRow[]).map(flattenTags)
  if (opts.tagId) {
    rows = rows.filter((r) => r.tag_ids.includes(opts.tagId!))
  }
  return rows
}

export type FaqRow = {
  id: string
  question: string
  answer: string
  category_id: string | null
  position: number
  is_published: boolean
  created_at: string
  updated_at: string
}

export async function fetchFaqs(
  supabase: SupabaseClient,
  userId: string,
  opts: { categoryId?: string | null; q?: string } = {},
): Promise<FaqRow[]> {
  let query = supabase
    .from('knowledge_faqs')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (opts.categoryId === null) {
    query = query.is('category_id', null)
  } else if (typeof opts.categoryId === 'string') {
    query = query.eq('category_id', opts.categoryId)
  }
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`
    query = query.or(`question.ilike.${term},answer.ilike.${term}`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as FaqRow[]
}

export async function fetchFaq(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<FaqRow | null> {
  const { data, error } = await supabase
    .from('knowledge_faqs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as FaqRow | null) ?? null
}

export async function fetchDocument(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<DocumentRow | null> {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('*, knowledge_document_tags(tag_id)')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const tagIds =
    ((data as { knowledge_document_tags?: { tag_id: string }[] })
      .knowledge_document_tags ?? []).map((t) => t.tag_id)
  return { ...(data as DocumentRow), tag_ids: tagIds }
}
