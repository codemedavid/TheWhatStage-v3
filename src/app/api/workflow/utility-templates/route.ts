import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['appointment', 'order', 'account'] as const
type Category = (typeof VALID_CATEGORIES)[number]

function isValidCategory(v: unknown): v is Category {
  return VALID_CATEGORIES.includes(v as Category)
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('messenger_utility_templates')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ templates: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { name, category, body: templateBody, language, variables, buttons } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!isValidCategory(category)) {
    return NextResponse.json(
      { error: 'category must be one of: appointment, order, account' },
      { status: 400 },
    )
  }
  if (typeof templateBody !== 'string' || !templateBody.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }

  const insert: Record<string, unknown> = {
    user_id: user.id,
    name: name.trim(),
    category,
    body: templateBody.trim(),
    language: typeof language === 'string' && language.trim() ? language.trim() : 'en_US',
  }

  if (Array.isArray(variables)) insert.variables = variables
  if (Array.isArray(buttons)) insert.buttons = buttons

  const { data, error } = await supabase
    .from('messenger_utility_templates')
    .insert(insert)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'a template with this name and language already exists' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ template: data }, { status: 201 })
}
