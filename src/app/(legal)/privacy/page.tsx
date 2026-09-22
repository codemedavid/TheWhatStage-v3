import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy · WhatStage',
  description: 'How WhatStage collects, uses, and protects your data.',
}

const LAST_UPDATED = '22 September 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[#374151]">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-[family-name:var(--font-instrument-serif)] text-4xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-[#6B7280]">Last updated {LAST_UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-[#374151]">
        WhatStage is a customer-conversation and sales-pipeline tool for small businesses. This
        policy explains what the WhatStage web dashboard and the WhatStage mobile app collect, why,
        and who we share it with. It covers both the people who use WhatStage (&ldquo;you&rdquo;) and
        the customers who message your connected Facebook Page.
      </p>

      <Section title="What we collect">
        <p><strong>Account information.</strong> Your email address, a securely hashed password, and
        your display name, so you can sign in and we can attribute your activity.</p>
        <p><strong>Connected Facebook Pages.</strong> When you connect a Page, we store its ID, name,
        picture, and an access token issued by Meta so we can receive and send messages on your
        behalf. You can disconnect a Page at any time.</p>
        <p><strong>Customer conversations.</strong> Messages exchanged between your Page and its
        customers, including text, attachments, sender IDs, and timestamps.</p>
        <p><strong>Lead and project records.</strong> Names, phone numbers, email addresses, notes,
        pipeline stage, and the history of stage changes — much of which is captured automatically
        from conversations.</p>
        <p><strong>Form submissions.</strong> Whatever your action pages ask customers for, such as
        order or booking details.</p>
        <p><strong>Media you upload.</strong> Photos, videos, and voice notes you add to your media
        library or send to a customer.</p>
        <p><strong>Device information for notifications.</strong> If you enable push notifications in
        the mobile app, we store a push token and basic device details so alerts reach the right
        device. Removing the app or signing out revokes it.</p>
        <p><strong>Usage records.</strong> Feature and AI-usage events, including token counts, used
        for billing, quotas, and diagnosing problems.</p>
      </Section>

      <Section title="What the mobile app accesses on your device">
        <p><strong>Camera and photo library.</strong> Only when you choose to attach a photo or video
        to a message or your media library. We do not browse or upload anything you have not picked.</p>
        <p><strong>Notifications.</strong> Only to alert you about new customer messages.</p>
        <p>The app has no advertising, no third-party analytics SDKs, and no cross-app tracking. We do
        not collect location or contacts.</p>
      </Section>

      <Section title="How we use it">
        <p>To operate the service: deliver and display messages, maintain your pipeline, send the
        replies and forms you choose to send, and notify you of activity.</p>
        <p>To generate AI-assisted replies and classifications, when you enable those features.</p>
        <p>To bill you accurately, enforce plan limits, secure the service, and provide support.</p>
        <p>We do not sell your data, and we do not use your customers&rsquo; messages to train our own
        models.</p>
      </Section>

      <Section title="Who we share it with">
        <p>We use a small number of processors, each handling only what their function requires:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Supabase</strong> — database, authentication, and file storage.</li>
          <li><strong>Vercel</strong> — application hosting.</li>
          <li><strong>Meta (Facebook Messenger)</strong> — sending and receiving Page messages.</li>
          <li><strong>OpenRouter and DeepSeek</strong> — generating AI replies and classifications.
          Message content needed for a reply is sent to these providers at the time of the request.</li>
          <li><strong>ImageKit</strong> — image hosting and delivery.</li>
          <li><strong>Expo</strong> — delivering push notifications to your device.</li>
          <li><strong>Resend</strong> — transactional email.</li>
          <li><strong>PayMongo</strong> — subscription payments. Card details go directly to PayMongo;
          we never see or store them.</li>
        </ul>
        <p>We may also disclose information where the law requires it.</p>
      </Section>

      <Section title="Retention and deletion">
        <p>We keep your data for as long as your account is active. You can delete individual leads,
        projects, messages, and media from the dashboard at any time.</p>
        <p>To delete your entire account and its data, email{' '}
          <a className="underline" href="mailto:hello@whatstage.app">hello@whatstage.app</a> from your
          account address. We action deletion within 30 days, except where we must retain records for
          legal or accounting reasons. See <a className="underline" href="/support">Support</a> for
          details.</p>
      </Section>

      <Section title="Your rights">
        <p>You may request access to, correction of, or deletion of your personal data, and a copy of
        it in a portable format. Contact us at{' '}
          <a className="underline" href="mailto:hello@whatstage.app">hello@whatstage.app</a>.</p>
        <p>If you operate a connected Page, you are the controller of your customers&rsquo; data and
        WhatStage acts as your processor. You are responsible for telling your customers how you use
        their information.</p>
      </Section>

      <Section title="Security">
        <p>Data is encrypted in transit. Every record is scoped to its owning account and enforced at
        the database level, so one account cannot read another&rsquo;s data. Access tokens and secrets
        are stored encrypted.</p>
      </Section>

      <Section title="Children">
        <p>WhatStage is a business tool and is not directed at children under 13, and we do not
        knowingly collect their personal information.</p>
      </Section>

      <Section title="Changes">
        <p>If we make a material change to this policy we will update the date above and, where
        appropriate, notify you in the app.</p>
      </Section>

      <Section title="Contact">
        <p>Questions about this policy or your data:{' '}
          <a className="underline" href="mailto:hello@whatstage.app">hello@whatstage.app</a>.</p>
      </Section>
    </article>
  )
}
