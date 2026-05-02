import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChatbotConfig } from '@/lib/chatbot/config'
import { ConfigForm } from './_components/ConfigForm'
import { TestChat } from './_components/TestChat'
import './chatbot.css'

export const dynamic = 'force-dynamic'

export default async function ChatbotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const config = await getChatbotConfig(supabase, user.id)

  return (
    <div data-chatbot-page>
      <div className="cb-wrap">
        <div className="cb-editor">
          <div className="cb-page-head">
            <div className="cb-page-head-meta">
              <div className="cb-eyebrow">
                <span className="cb-eyebrow-dot" aria-hidden />
                <span>Workspace · Chatbot</span>
              </div>
              <h1>Chatbot</h1>
              <p className="cb-page-sub">
                Configure your assistant&apos;s personality and rules, then test it
                against your knowledge base.
              </p>
            </div>
            <div className="cb-page-head-actions">
              <span className="cb-status-pill live">
                <span className="cb-status-dot" />
                Active
              </span>
            </div>
          </div>

          <div className="cb-tips-card">
            <div className="cb-tips-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8L19 10l-4.5 3.5L16 19l-4-3-4 3 1.5-5.5L5 10l5.1-1.2z" /></svg>
            </div>
            <div className="cb-tips-body">
              <b>Tip:</b> A great assistant has a clear voice + tight guardrails.
              Keep the personality concise, then list 5–8 DO/DON&apos;T rules. Less is more.
            </div>
          </div>

          <ConfigForm initial={config} />
        </div>

        <aside className="cb-test-aside">
          <TestChat name={config.name} />
        </aside>
      </div>
    </div>
  )
}
