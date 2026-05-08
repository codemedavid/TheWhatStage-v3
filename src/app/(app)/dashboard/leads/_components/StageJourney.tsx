'use client'
import { useEffect, useState, useTransition } from 'react'
import {
  loadStageJourney,
  type StageJourney as StageJourneyData,
} from '../actions/messenger'

export function StageJourney({
  leadId,
  stageId,
}: {
  leadId: string
  stageId: string
}) {
  const [data, setData] = useState<StageJourneyData | null | 'loading'>('loading')
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(() => setData('loading'))
    loadStageJourney(leadId)
      .then((r) => {
        if (!cancelled) startTransition(() => setData(r))
      })
      .catch(() => {
        if (!cancelled) startTransition(() => setData(null))
      })
    return () => {
      cancelled = true
    }
  }, [leadId, stageId, startTransition])

  if (data === 'loading') {
    return (
      <div className="text-[12px]" style={{ color: 'var(--lead-faint)' }}>
        Loading journey…
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="text-[12px]" style={{ color: 'var(--lead-faint)' }}>
        Couldn’t load stage journey.
      </div>
    )
  }

  const { events, current_stage_name, created_at } = data

  if (events.length === 0) {
    return (
      <div
        className="rounded-lg px-3 py-2.5 text-[12.5px]"
        style={{
          background: 'var(--lead-surface-2)',
          border: '1px solid var(--lead-line)',
          color: 'var(--lead-body)',
        }}
      >
        No stage changes yet
        {current_stage_name ? (
          <>
            . Currently in <strong>{current_stage_name}</strong>.
          </>
        ) : (
          '.'
        )}
      </div>
    )
  }

  return (
    <ol className="relative ml-1.5">
      <span
        aria-hidden
        className="absolute left-[5px] top-1 bottom-1 w-px"
        style={{ background: 'var(--lead-line)' }}
      />
      {created_at && (
        <JourneyDot
          when={created_at}
          source="user"
          title="Lead created"
          subtitle={
            events[0]?.from_stage_name ? `in ${events[0].from_stage_name}` : null
          }
        />
      )}
      {events.map((e) => (
        <JourneyDot
          key={e.id}
          when={e.created_at}
          source={e.source}
          title={
            e.from_stage_name && e.to_stage_name
              ? `${e.from_stage_name} → ${e.to_stage_name}`
              : e.to_stage_name
                ? `Moved to ${e.to_stage_name}`
                : 'Stage change'
          }
          subtitle={e.reason?.trim() || null}
          confidence={e.confidence}
        />
      ))}
    </ol>
  )
}

function JourneyDot({
  when,
  source,
  title,
  subtitle,
  confidence,
}: {
  when: string
  source: 'ai' | 'user'
  title: string
  subtitle: string | null
  confidence?: 'low' | 'medium' | 'high' | null
}) {
  const isAi = source === 'ai'
  const stamp = new Date(when).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <li className="relative pl-5 pb-3 last:pb-0">
      <span
        aria-hidden
        className="absolute left-0 top-[5px] h-[11px] w-[11px] rounded-full"
        style={{
          background: isAi ? 'var(--lead-accent)' : 'var(--lead-surface)',
          border: `1.5px solid ${isAi ? 'var(--lead-accent)' : 'var(--lead-muted)'}`,
        }}
      />
      <div className="flex items-baseline gap-2">
        <span
          className="text-[12.5px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {title}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider"
          style={{
            background: 'var(--lead-surface-2)',
            border: '1px solid var(--lead-line)',
            color: 'var(--lead-body)',
          }}
        >
          {isAi ? 'AI' : 'Manual'}
        </span>
        {confidence && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px]"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
          >
            {confidence}
          </span>
        )}
        <span
          className="ml-auto text-[11px]"
          style={{ color: 'var(--lead-faint)' }}
        >
          {stamp}
        </span>
      </div>
      {subtitle && (
        <div
          className="mt-0.5 text-[12px] leading-relaxed"
          style={{ color: 'var(--lead-body)' }}
        >
          {subtitle}
        </div>
      )}
    </li>
  )
}
