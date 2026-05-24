import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChatbotConfig } from '@/lib/chatbot/config'
import { listPublicTemplates, getLatestAppliedAdoption } from '@/lib/chatbot/personality/queries'
import { fetchMediaAssets, fetchMediaFolders } from '@/app/(app)/dashboard/media/_lib/queries'
import { ConfigForm } from './_components/ConfigForm'
import { TestChat } from './_components/TestChat'
import { PersonalityTemplates } from './_components/PersonalityTemplates'
import { PrimaryGoalSection, type PrimaryGoalOption } from './_components/PrimaryGoalSection'
import { ChatbotTabs } from './_components/ChatbotTabs'
import { AutoFollowupForm } from './_components/AutoFollowupForm'
import { HumanTakeoverForm } from './_components/HumanTakeoverForm'
import type { PersonalityTemplate } from '@/lib/chatbot/personality/types'
import './chatbot.css'

export const dynamic = 'force-dynamic'

export default async function ChatbotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [config, templates, latestAdoption, mediaFolders, mediaAssets, actionPagesData] = await Promise.all([
    getChatbotConfig(supabase, user.id),
    listPublicTemplates(supabase),
    getLatestAppliedAdoption(supabase, user.id),
    fetchMediaFolders(supabase, user.id),
    fetchMediaAssets(supabase, user.id, null),
    supabase
      .from('action_pages')
      .select('id, slug, title, cta_label')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .order('title', { ascending: true }),
  ])
  const actionPages = (actionPagesData.data ?? []).map((p) => ({
    id: p.id as string,
    slug: p.slug as string,
    title: p.title as string,
    ctaLabel: (p.cta_label as string | null) ?? '',
  }))

  const goalOptions: PrimaryGoalOption[] = actionPages.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
  }))

  const activeTemplate = config.activeTemplateId
    ? (templates.find((t) => t.id === config.activeTemplateId) ?? null)
    : null

  const personalityContent = (
    <>
      <PersonalityTemplates
        templates={templates}
        activeTemplate={activeTemplate as PersonalityTemplate | null}
        activeAdoptionId={latestAdoption?.id ?? null}
      />
      <PrimaryGoalSection
        current={config.primaryActionPageId ?? null}
        options={goalOptions}
      />
      <ConfigForm
        key={config.updatedAt}
        initial={config}
        mediaFolders={mediaFolders}
        mediaAssets={mediaAssets}
        actionPages={actionPages}
      />
    </>
  )

  const followupContent = (
    <>
      <AutoFollowupForm
        initial={config.followupSettings}
        actionPages={actionPages.map((p) => ({ id: p.id, title: p.title }))}
      />
      <HumanTakeoverForm />
    </>
  )

  return (
    <div data-chatbot-page>
      <div className="cb-wrap">
        <div className="cb-editor">
          <ChatbotTabs
            personalityContent={personalityContent}
            followupContent={followupContent}
          />
        </div>

        <aside className="cb-test-aside">
          <TestChat name={config.name} />
        </aside>
      </div>
    </div>
  )
}
