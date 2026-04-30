import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import { fetchActionPage, fetchPipelineStages } from '../_lib/queries'
import { deleteActionPage, updateActionPage } from '../actions/crud'
import { CopyField } from '../_components/CopyField'
import { KindEditor } from '../_components/KindEditor'
import { PipelineRulesEditor } from '../_components/PipelineRulesEditor'

export default async function ActionPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const saved = sp.saved === '1'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [page, stages] = await Promise.all([
    fetchActionPage(supabase, user.id, id),
    fetchPipelineStages(supabase, user.id),
  ])
  if (!page) notFound()

  const meta = KIND_REGISTRY[page.kind]
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const publicUrl = `${baseUrl}/a/${page.slug}`
  const embedUrl = `${baseUrl}/a/${page.slug}/embed`
  const embedSnippet = `<iframe src="${embedUrl}" width="100%" height="640" frameborder="0"></iframe>`

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/action-pages"
            className="text-[12px] text-[#6B7280] hover:text-[#111827]"
          >
            ← Back
          </Link>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#111827]">
            {page.title}
          </h1>
          <p className="mt-0.5 text-[13px] text-[#6B7280]">
            {meta.label} · {meta.blurb}
          </p>
        </div>
        <Link
          href={`/dashboard/action-pages/${page.id}/submissions`}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
        >
          View submissions
        </Link>
      </header>

      {saved && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
          Saved.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error}
          {detail ? ` — ${detail}` : null}
        </div>
      )}

      <form action={updateActionPage} className="space-y-6">
        <input type="hidden" name="id" value={page.id} />

        <Section title="General">
          <Field label="Title">
            <input
              name="title"
              defaultValue={page.title}
              required
              maxLength={120}
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            />
          </Field>
          <Field label="Slug">
            <input
              name="slug"
              defaultValue={page.slug}
              required
              pattern="[a-z0-9][a-z0-9-]*"
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-[13px]"
            />
            <p className="mt-1 text-[12px] text-[#6B7280]">
              Public URL: <span className="font-mono">/a/{page.slug}</span>
            </p>
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              defaultValue={page.description ?? ''}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            />
          </Field>
          <Field label="Status">
            <select
              name="status"
              defaultValue={page.status}
              className="rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </Section>

        <Section title="Pipeline rules">
          <PipelineRulesEditor initial={page.pipeline_rules} stages={stages} />
        </Section>

        <Section title="Messenger echo">
          <p className="text-[12px] text-[#6B7280]">
            Plain-text confirmation sent back to the lead in Messenger after a
            successful submission. Leave empty to skip.
          </p>
          <textarea
            name="notification_text"
            defaultValue={page.notification_template?.text ?? ''}
            rows={3}
            maxLength={640}
            placeholder="Thanks! We got your details and will be in touch shortly."
            className="mt-2 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
          />
        </Section>

        <Section title={`${meta.label} configuration`}>
          <KindEditor page={page} />
        </Section>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            className="rounded-md bg-[#059669] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
          >
            Save changes
          </button>
        </div>
      </form>

      <Section title="Share">
        <Field label="Public URL">
          <CopyField value={publicUrl} label="Public URL" />
        </Field>
        {meta.supportsEmbed && (
          <>
            <Field label="Embed URL">
              <CopyField value={embedUrl} label="Embed URL" />
            </Field>
            <Field label="Embed snippet">
              <CopyField value={embedSnippet} label="Embed snippet" />
            </Field>
          </>
        )}
      </Section>

      <Section title="Danger zone">
        <form action={deleteActionPage}>
          <input type="hidden" name="id" value={page.id} />
          <button
            type="submit"
            className="rounded-md border border-red-200 bg-white px-3 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50"
          >
            Delete this action page
          </button>
        </form>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white p-5">
      <h2 className="text-[14px] font-semibold text-[#111827]">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      {children}
    </label>
  )
}
