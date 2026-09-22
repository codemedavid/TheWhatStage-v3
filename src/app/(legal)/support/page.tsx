import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Support · WhatStage',
  description: 'Get help with WhatStage, or request account deletion.',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[#374151]">{children}</div>
    </section>
  )
}

export default function SupportPage() {
  return (
    <article>
      <h1 className="font-[family-name:var(--font-instrument-serif)] text-4xl">Support</h1>
      <p className="mt-6 text-[15px] leading-relaxed text-[#374151]">
        Need a hand with WhatStage? Email{' '}
        <a className="underline" href="mailto:hello@whatstage.app">hello@whatstage.app</a> and we
        will get back to you, usually within one business day. Telling us your account email and what
        you were doing when the problem happened gets you a faster answer.
      </p>

      <Section title="Getting started on mobile">
        <p>The WhatStage mobile app is a companion to the web dashboard — you need a WhatStage
        account before you can sign in.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create your account and connect a Facebook Page on the web dashboard.</li>
          <li>Open the mobile app and sign in with the same email and password.</li>
          <li>Allow notifications when prompted so you hear about new customer messages.</li>
        </ol>
      </Section>

      <Section title="Common questions">
        <p><strong>My Page is connected but the bot is not replying.</strong> Check that the Page is
        still connected in Settings, and that auto-reply is switched on for that conversation. If
        another chatbot app also manages the Page, it can hold the conversation — disconnect it and
        try again.</p>
        <p><strong>I am not getting notifications.</strong> Confirm notifications are enabled for
        WhatStage in your device settings, then sign out and back in to re-register the device.</p>
        <p><strong>A message failed to send.</strong> Meta only allows a business to message a
        customer within 24 hours of their last message. After that window, the send is blocked until
        the customer writes again.</p>
        <p><strong>I cannot sign in on mobile.</strong> Use the same credentials as the dashboard.
        Reset your password on the web if you are unsure.</p>
      </Section>

      <Section title="Deleting your account">
        <p>You can delete your WhatStage account and everything in it at any time.</p>
        <p>Email <a className="underline" href="mailto:hello@whatstage.app">hello@whatstage.app</a>{' '}
        from the address on your account with the subject <strong>Delete my account</strong>. We
        confirm the request, then permanently remove your account, connected Pages, conversations,
        leads, projects, and uploaded media within 30 days. Some billing records are retained where
        the law requires.</p>
        <p>To remove individual items instead, delete them directly in the dashboard.</p>
      </Section>

      <Section title="Privacy">
        <p>Our <a className="underline" href="/privacy">Privacy Policy</a> explains what we collect
        and who processes it.</p>
      </Section>
    </article>
  )
}
