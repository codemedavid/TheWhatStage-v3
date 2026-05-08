import type { CSSProperties } from 'react'
import type { KindRendererProps } from '../types'
import {
  parseFormConfig,
  type FieldBlock,
  type FormBlock,
} from './schema'

export default function FormRenderer({
  page,
  claims,
  rawToken,
  sourceContext,
}: KindRendererProps) {
  const config = parseFormConfig(page.config)

  const rootStyle: CSSProperties & Record<string, string> = {
    ['--bg']: config.theme.background_color,
    ['--accent']: config.theme.accent_color,
    ['--accent-fg']: config.theme.button_text_color,
    backgroundColor: 'var(--bg)',
  }

  return (
    <div className="space-y-5" style={rootStyle}>
      <header className="space-y-2">
        {config.branding.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={config.branding.logo_url}
            alt=""
            className="h-10 w-auto"
          />
        )}
        {page.description && (
          <p className="text-[14px] text-[#6B7280]">{page.description}</p>
        )}
      </header>

      <form
        action="/api/action-pages/submit"
        method="post"
        className="space-y-4"
      >
        <input type="hidden" name="slug" value={page.slug} />
        {claims && rawToken && (
          <>
            <input type="hidden" name="p" value={claims.psid} />
            <input type="hidden" name="g" value={claims.pageId} />
            <input type="hidden" name="e" value={String(claims.exp)} />
            <input type="hidden" name="t" value={rawToken} />
          </>
        )}
        {sourceContext?.source_property_action_page_id && (
          <>
            <input
              type="hidden"
              name="source_property_action_page_id"
              value={sourceContext.source_property_action_page_id}
            />
            <input
              type="hidden"
              name="source_property_title"
              value={sourceContext.source_property_title ?? ''}
            />
            {sourceContext.source_property_unit_id && (
              <>
                <input
                  type="hidden"
                  name="source_property_unit_id"
                  value={sourceContext.source_property_unit_id}
                />
                <input
                  type="hidden"
                  name="source_property_unit_title"
                  value={sourceContext.source_property_unit_title ?? ''}
                />
              </>
            )}
          </>
        )}
        {sourceContext?.source_sales_page_id && (
          <>
            <input
              type="hidden"
              name="source_sales_page_id"
              value={sourceContext.source_sales_page_id}
            />
            <input
              type="hidden"
              name="source_sales_page_title"
              value={sourceContext.source_sales_page_title ?? ''}
            />
          </>
        )}

        {config.blocks.map((block) => (
          <BlockView key={block.id} block={block} />
        ))}

        <button
          type="submit"
          className="w-full rounded-md px-3 py-2 text-[14px] font-semibold"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--accent-fg)',
          }}
        >
          {config.submit_button_label}
        </button>
      </form>
    </div>
  )
}

function BlockView({ block }: { block: FormBlock }) {
  if (block.type === 'heading') {
    const className =
      block.level === 1
        ? 'text-[24px] font-semibold text-[#111827]'
        : block.level === 2
        ? 'text-[18px] font-semibold text-[#111827]'
        : 'text-[15px] font-semibold text-[#111827]'
    if (block.level === 1) return <h2 className={className}>{block.text}</h2>
    if (block.level === 2) return <h3 className={className}>{block.text}</h3>
    return <h4 className={className}>{block.text}</h4>
  }
  if (block.type === 'description') {
    return (
      <p className="whitespace-pre-wrap text-[14px] text-[#374151]">
        {block.text}
      </p>
    )
  }
  return <FieldView block={block} />
}

function FieldView({ block }: { block: FieldBlock }) {
  const name = `data.${block.key}`
  const id = `f-${block.id}`
  const baseInput =
    'w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]'

  return (
    <div className="space-y-1">
      {block.field_kind !== 'checkbox' && (
        <label
          htmlFor={id}
          className="block text-[12px] font-semibold text-[#374151]"
        >
          {block.label}
          {block.required && <span className="ml-0.5 text-red-600">*</span>}
        </label>
      )}

      {block.field_kind === 'short_text' && (
        <input
          id={id}
          name={name}
          type="text"
          required={block.required}
          placeholder={block.placeholder}
          className={baseInput}
        />
      )}
      {block.field_kind === 'long_text' && (
        <textarea
          id={id}
          name={name}
          required={block.required}
          placeholder={block.placeholder}
          rows={4}
          className={baseInput}
        />
      )}
      {block.field_kind === 'email' && (
        <input
          id={id}
          name={name}
          type="email"
          required={block.required}
          placeholder={block.placeholder}
          className={baseInput}
        />
      )}
      {block.field_kind === 'phone' && (
        <input
          id={id}
          name={name}
          type="tel"
          required={block.required}
          placeholder={block.placeholder}
          className={baseInput}
        />
      )}
      {block.field_kind === 'number' && (
        <input
          id={id}
          name={name}
          type="number"
          required={block.required}
          placeholder={block.placeholder}
          className={baseInput}
        />
      )}
      {block.field_kind === 'select' && (
        <select
          id={id}
          name={name}
          required={block.required}
          defaultValue=""
          className={baseInput}
        >
          <option value="" disabled>
            {block.placeholder ?? 'Select…'}
          </option>
          {(block.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {block.field_kind === 'radio' && (
        <fieldset className="space-y-1">
          {(block.options ?? []).map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 text-[14px] text-[#374151]"
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                required={block.required}
                className="h-4 w-4"
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
      {block.field_kind === 'checkbox' && (
        <label className="flex items-start gap-2 text-[14px] text-[#374151]">
          <input
            id={id}
            type="checkbox"
            name={name}
            value="true"
            required={block.required}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            {block.label}
            {block.required && <span className="ml-0.5 text-red-600">*</span>}
          </span>
        </label>
      )}
    </div>
  )
}
