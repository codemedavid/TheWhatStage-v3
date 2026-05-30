'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { FormConfig, FieldBlock } from '@/app/a/[slug]/_kinds/form/schema'

/**
 * Studio-mode preview for Form action pages. Renders the themed public-page
 * card with each block tagged via `data-block="<id>"` so the studio shell
 * can paint a selection overlay (corner brackets + label tag) on hover/select.
 *
 * Keeps the visual fidelity of the design's FormPreview (cream + accent
 * theme, inline selection rings) without binding to the public Renderer —
 * the public renderer is server-side and we need a live client view.
 */
export function FormStudioPreview({
  title,
  description,
  config,
  selectedBlockId,
  operatorWordmark,
  previewRef,
}: {
  title: string
  description: string
  slug?: string
  config: FormConfig
  selectedBlockId: string | null
  operatorWordmark?: string | null
  previewRef?: React.Ref<HTMLDivElement>
}) {
  const accent = config.theme.accent_color
  const accentFg = config.theme.button_text_color
  const bg = config.theme.background_color

  const cssVars: CSSProperties & Record<string, string> = {
    ['--fp-bg']: bg,
    ['--fp-accent']: accent,
    ['--fp-accent-fg']: accentFg,
  }

  const fieldBlocks = config.blocks.filter((b) => b.type === 'field') as FieldBlock[]

  return (
    <div className="fp-stage">
      <div className="fp-card" style={cssVars} ref={previewRef}>
        <BlockBox blockId="branding" selected={selectedBlockId === 'branding'}>
          <div className="fp-branding">
            <div
              className="fp-mark"
              style={{ background: accent, color: accentFg }}
            >
              {(operatorWordmark || title || 'F').trim().charAt(0).toUpperCase()}
            </div>
            <span className="fp-wordmark">
              {operatorWordmark || 'Your brand'}
            </span>
          </div>
        </BlockBox>

        {title.trim() && (
          <BlockBox blockId="__title" selected={selectedBlockId === 'basics'}>
            <h1 className="fp-title">{title}</h1>
          </BlockBox>
        )}

        {description.trim() && (
          <BlockBox blockId="__desc" selected={selectedBlockId === 'basics'}>
            <p className="fp-desc">{description}</p>
          </BlockBox>
        )}

        {config.blocks.map((b) => {
          if (b.type === 'heading') {
            const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3'
            return (
              <BlockBox
                key={b.id}
                blockId={b.id}
                selected={selectedBlockId === b.id}
              >
                <Tag
                  className={`fp-heading fp-heading-${b.level}`}
                  style={{ margin: 0 }}
                >
                  {b.text || 'Section heading'}
                </Tag>
              </BlockBox>
            )
          }
          if (b.type === 'description') {
            return (
              <BlockBox
                key={b.id}
                blockId={b.id}
                selected={selectedBlockId === b.id}
              >
                <p className="fp-desc">{b.text}</p>
              </BlockBox>
            )
          }
          return null
        })}

        {fieldBlocks.length > 0 && (
          <div className="fp-fields">
            {fieldBlocks.map((f) => (
              <BlockBox
                key={f.id}
                blockId={f.id}
                selected={selectedBlockId === f.id}
                inline
              >
                <FieldRender field={f} accent={accent} />
              </BlockBox>
            ))}
          </div>
        )}

        <BlockBox blockId="submit" selected={selectedBlockId === 'submit'}>
          <button
            type="button"
            className="fp-submit"
            style={{ background: accent, color: accentFg }}
            tabIndex={-1}
          >
            {config.submit_button_label || 'Submit'}
          </button>
        </BlockBox>
      </div>

      <div className="fp-foot">
        Sent via Messenger when a lead matches the trigger
      </div>
    </div>
  )
}

function BlockBox({
  blockId,
  selected,
  children,
  inline,
}: {
  blockId: string
  selected: boolean
  children: ReactNode
  inline?: boolean
}) {
  return (
    <div
      data-block={blockId}
      className={`fp-block${selected ? ' sel' : ''}${inline ? ' inline' : ''}`}
    >
      {children}
    </div>
  )
}

function FieldRender({ field, accent }: { field: FieldBlock; accent: string }) {
  const label = (
    <div className="fp-flabel">
      {field.label}
      {field.required && (
        <span className="fp-req" style={{ color: accent }}>
          *
        </span>
      )}
    </div>
  )
  let body: ReactNode
  if (field.field_kind === 'long_text') {
    body = (
      <div className="fp-input fp-textarea">
        {field.placeholder || ''}
      </div>
    )
  } else if (field.field_kind === 'select') {
    body = (
      <div className="fp-input fp-select">
        <span>{field.options?.[0]?.label ?? 'Select…'}</span>
        <span className="fp-chev">▾</span>
      </div>
    )
  } else if (field.field_kind === 'radio') {
    body = (
      <div className="fp-radios">
        {(field.options ?? []).map((o, i) => (
          <div key={o.value} className="fp-radio-row">
            <span
              className="fp-radio"
              style={{
                borderColor: i === 0 ? accent : 'rgba(0,0,0,.2)',
              }}
            >
              {i === 0 && (
                <span className="fp-radio-dot" style={{ background: accent }} />
              )}
            </span>
            {o.label}
          </div>
        ))}
      </div>
    )
  } else if (field.field_kind === 'checkbox') {
    return (
      <div className="fp-check-row">
        <span className="fp-check" />
        {field.label}
      </div>
    )
  } else if (field.field_kind === 'number') {
    body = <div className="fp-input">{field.placeholder || '0'}</div>
  } else {
    body = <div className="fp-input">{field.placeholder || ''}</div>
  }

  return (
    <>
      {label}
      {body}
    </>
  )
}
