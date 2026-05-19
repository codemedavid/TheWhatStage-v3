'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type TabKey = 'personality' | 'followup'

interface ChatbotTabsProps {
  personalityContent: ReactNode
  followupContent: ReactNode
}

export function ChatbotTabs({ personalityContent, followupContent }: ChatbotTabsProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/dashboard/chatbot'
  const searchParams = useSearchParams()
  const urlTab = searchParams?.get('tab')
  const initial: TabKey = urlTab === 'followup' ? 'followup' : 'personality'
  const [active, setActive] = useState<TabKey>(initial)

  // Keep URL in sync when the user clicks a tab.
  useEffect(() => {
    const next = new URLSearchParams(searchParams?.toString() ?? '')
    if (active === 'personality') {
      next.delete('tab')
    } else {
      next.set('tab', active)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [active, pathname, router, searchParams])

  return (
    <>
      <nav
        role="tablist"
        aria-label="Chatbot sections"
        className="cb-toplevel-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={active === 'personality'}
          className={`cb-toplevel-tab${active === 'personality' ? ' active' : ''}`}
          onClick={() => setActive('personality')}
        >
          Personality
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'followup'}
          className={`cb-toplevel-tab${active === 'followup' ? ' active' : ''}`}
          onClick={() => setActive('followup')}
        >
          Auto Follow-Up
        </button>
      </nav>

      <div role="tabpanel" hidden={active !== 'personality'}>
        {personalityContent}
      </div>
      <div role="tabpanel" hidden={active !== 'followup'}>
        {followupContent}
      </div>
    </>
  )
}
