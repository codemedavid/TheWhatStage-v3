import Link from 'next/link'

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="font-[family-name:var(--font-instrument-serif)] text-xl">
            WhatStage
          </Link>
          <nav className="flex gap-6 text-sm text-[#6B7280]">
            <Link href="/privacy" className="hover:text-[#111827]">Privacy</Link>
            <Link href="/support" className="hover:text-[#111827]">Support</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">{children}</main>
      <footer className="border-t border-[#E5E7EB] bg-white">
        <div className="mx-auto max-w-3xl px-6 py-6 text-sm text-[#6B7280]">
          © {new Date().getFullYear()} WhatStage ·{' '}
          <a href="mailto:hello@whatstage.app" className="underline hover:text-[#111827]">
            hello@whatstage.app
          </a>
        </div>
      </footer>
    </div>
  )
}
