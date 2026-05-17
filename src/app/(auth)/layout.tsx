import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { getPostAuthRedirect } from '@/lib/onboarding/post-auth-redirect'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (session) redirect(await getPostAuthRedirect())

  return (
    <div className="auth-shell min-h-screen grid lg:grid-cols-[1.15fr_1fr] bg-[#F5F1E8] text-[#1F1E1D]">
      <aside className="relative flex flex-col justify-between overflow-hidden border-b lg:border-b-0 lg:border-r border-[#E5DFD0] px-6 py-9 lg:px-12 lg:py-9 bg-[radial-gradient(70%_60%_at_20%_0%,rgba(201,100,66,0.16)_0%,transparent_60%),radial-gradient(50%_40%_at_100%_100%,rgba(201,100,66,0.12)_0%,transparent_60%),#F5F1E8]">
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(201,100,66,0.22), transparent 70%)',
          }}
        />

        <Link
          href="/"
          className="relative z-10 inline-flex items-center gap-3 font-[family-name:var(--font-instrument-serif)] text-[22px] tracking-tight"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#1F1E1D] pb-[2px] font-[family-name:var(--font-instrument-serif)] text-[19px] italic leading-none text-[#FBF8F1]">
            W
          </span>
          WhatStage
        </Link>

        <div className="relative z-10 max-w-[460px] py-6 lg:py-0">
          <span className="mb-6 inline-flex items-center gap-2.5 whitespace-nowrap rounded-full bg-[rgba(242,221,210,0.6)] py-[5px] pl-[5px] pr-3.5 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.12em]">
            <span className="rounded-full border border-[rgba(201,100,66,0.25)] bg-white px-[7px] py-[3px] text-[10px] text-[#C96442]">
              ✦
            </span>
            <span className="text-[#6E2E1B]">Less inbox. More sales.</span>
          </span>

          <h1 className="mb-7 font-[family-name:var(--font-instrument-serif)] text-[clamp(36px,4vw,56px)] font-normal leading-[1.08] tracking-[-0.022em] text-balance">
            Answer every Messenger DM{' '}
            <em className="italic text-[#C96442]">24/7</em>, in your
            customers&rsquo; language.
          </h1>
          <p className="mb-8 max-w-[440px] text-[15.5px] leading-[1.55] text-[#3A3835]">
            Inbox-zero without lifting a finger. Your bot answers in your
            voice, captures leads, and follows up — even while you sleep.
          </p>

          <ul className="flex max-w-[440px] flex-col gap-4">
            {[
              {
                ico: '✦',
                t: 'Always-on replies',
                s: 'Handle Messenger inquiries 24/7 while you focus on the business.',
              },
              {
                ico: '◐',
                t: 'In their language',
                s: 'Tagalog, Taglish, English — whatever your customers ask in.',
              },
              {
                ico: '◇',
                t: 'Funnel to checkout',
                s: 'Catalog, booking, or lead capture — wired to GCash and email.',
              },
            ].map((p) => (
              <li key={p.t} className="flex items-start gap-3.5">
                <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-[#E5DFD0] bg-white font-[family-name:var(--font-instrument-serif)] text-[17px] text-[#C96442]">
                  {p.ico}
                </span>
                <span className="pt-0.5">
                  <span className="block text-[15px] font-medium text-[#1F1E1D]">
                    {p.t}
                  </span>
                  <span className="block text-[13.5px] leading-[1.5] text-[#6B6862]">
                    {p.s}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 hidden items-center justify-between font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.08em] text-[#6B6862] lg:flex">
          <span>© 2026 WhatStage · Made in PH</span>
          <span className="flex gap-[18px]">
            <Link href="/privacy" className="hover:text-[#1F1E1D]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[#1F1E1D]">
              Terms
            </Link>
          </span>
        </div>
      </aside>

      <section className="flex flex-col bg-[#FBF8F1] px-6 py-6 lg:px-9 lg:py-6">
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
        <div className="pb-2 text-center text-[13.5px] text-[#6B6862]">
          Need help?{' '}
          <a
            href="mailto:hello@whatstage.app"
            className="font-medium text-[#C96442] hover:underline"
          >
            Message the team
          </a>
        </div>
      </section>
    </div>
  )
}
