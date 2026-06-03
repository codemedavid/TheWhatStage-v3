'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'

/* ── types ──────────────────────────────────────────────────────────── */
export interface DashStats {
  bookingsToday: number
  bookingsWeek: number
  leadsWeek: number
  submissionsMonth: number
}

export interface RecentSubmission {
  id: string
  name: string | null
  actionPageTitle: string
  createdAt: string
}

export interface DashboardClientProps {
  userName: string
  hasBusiness: boolean
  hasKnowledge: boolean
  hasPersonality: boolean
  hasActiveActionPages: boolean
  hasFacebook: boolean
  stats: DashStats
  recentSubmissions: RecentSubmission[]
}

/* ── responsive CSS ─────────────────────────────────────────────────── */
const CSS = `
.db-wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 32px 80px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.db-hero {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 28px;
  position: relative;
  overflow: hidden;
}
.db-hero-video {
  display: block;
}
.db-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.db-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.db-qa-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.db-vid-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.db-checklist-row {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
}
.db-checklist-time { display: inline-flex; }
.db-vid-next-title { display: inline; }
.db-vid-next-len { display: inline; }

/* tablet */
@media (max-width: 1024px) {
  .db-stats { grid-template-columns: repeat(2, 1fr); }
  .db-vid-grid { grid-template-columns: repeat(2, 1fr); }
}

/* phablet */
@media (max-width: 768px) {
  .db-wrap { padding: 20px 16px 72px; gap: 24px; }
  .db-hero { grid-template-columns: 1fr; gap: 20px; }
  .db-hero-video { display: none; }
  .db-two-col { grid-template-columns: 1fr; gap: 20px; }
  .db-checklist-row { padding: 12px 14px; gap: 10px; }
  .db-checklist-time { display: none; }
}

/* mobile */
@media (max-width: 480px) {
  .db-wrap { padding: 16px 12px 64px; gap: 20px; }
  .db-stats { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .db-qa-grid { grid-template-columns: 1fr; }
  .db-vid-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .db-vid-next-title { display: none; }
  .db-vid-next-len { display: none; }
  .db-checklist-row { grid-template-columns: 28px 1fr auto; }
}
`

/* ── videos ──────────────────────────────────────────────────────────── */
/* `loomId` is the share ID from a Loom URL (loom.com/share/<id>); `thumb` is
   its CDN preview gif. Add entries here as new tutorials are recorded — the
   grid, progress dots, and player modal all scale automatically. */
type Video = {
  id: string
  num: string
  title: string
  length: string
  tag: string
  color: string
  desc: string
  loomId?: string
  thumb?: string
}

const VIDEOS: Video[] = [
  { id: 'v1', num: '01', title: 'Welcome & setting up your knowledge', length: '11:08', tag: 'Start here',   color: '#1F7A4D', desc: 'A tour of your dashboard and how to set up the knowledge that powers your chatbot.', loomId: '6a9d2bdb59954e4eb68ed860ad09bd95', thumb: 'https://cdn.loom.com/sessions/thumbnails/6a9d2bdb59954e4eb68ed860ad09bd95-904e470765f7f6cf.gif' },
  { id: 'v2', num: '02', title: 'Create your chatbot personality',     length: '6:54',  tag: 'Chatbot',      color: '#7C3AED', desc: 'Give your chatbot a voice and personality that matches your brand.',                 loomId: 'fc339f11b00d468bacb5cd0ec956ce34', thumb: 'https://cdn.loom.com/sessions/thumbnails/fc339f11b00d468bacb5cd0ec956ce34-860a8f3021a72de1.gif' },
  { id: 'v3', num: '03', title: 'Write instructions for your chatbot',  length: '4:40',  tag: 'Chatbot',      color: '#2563EB', desc: 'Add instructions that guide how your chatbot responds to leads.',                    loomId: '99dc0b13bf40430ba34bc52eef6c6b79', thumb: 'https://cdn.loom.com/sessions/thumbnails/99dc0b13bf40430ba34bc52eef6c6b79-8ce54c3372353130.gif' },
  { id: 'v4', num: '04', title: 'Send images to your Messenger leads',  length: '5:19',  tag: 'Channels',     color: '#C2410C', desc: 'Organise media into folders and train the bot with hashtags so it sends the right image on request.', loomId: '8f92982ae6b74dea87dfafe8898376d1', thumb: 'https://cdn.loom.com/sessions/thumbnails/8f92982ae6b74dea87dfafe8898376d1-aa564366beb33895.gif' },
  { id: 'v5', num: '05', title: 'Action pages, explained',              length: '3:22',  tag: 'Action Pages', color: '#0F766E', desc: 'A tour of every action page type — forms, bookings, quizzes, sales pages, catalogues, and listings.', loomId: 'c66861d539c94655a3ee0b26a335315b', thumb: 'https://cdn.loom.com/sessions/thumbnails/c66861d539c94655a3ee0b26a335315b-d6318a8707a773b7.gif' },
  { id: 'v6', num: '06', title: 'Create a booking action page',         length: '6:26',  tag: 'Action Pages', color: '#B45309', desc: 'Build and configure a booking page — availability hours and form fields included.', loomId: 'a21f9b5d099f4a20be77467584b6cf9f', thumb: 'https://cdn.loom.com/sessions/thumbnails/a21f9b5d099f4a20be77467584b6cf9f-a7e25a631f005374.gif' },
  { id: 'v7', num: '07', title: 'Add an action page to your conversation flow', length: '3:34', tag: 'Chatbot', color: '#6D28D9', desc: 'Link an action page into your chatbot flow and instructions so it triggers at the right moment.', loomId: '8a191bb710c148d8a0f499c78d86da58', thumb: 'https://cdn.loom.com/sessions/thumbnails/8a191bb710c148d8a0f499c78d86da58-73cfc76adaed568c.gif' },
]

const STORAGE_KEY = 'ws_videos_watched'

/* ── icons ──────────────────────────────────────────────────────────── */
const CalendarIcon  = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
const LeadsIcon     = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.5 0 5 1.5 5 5"/></svg>
const ChatbotIcon   = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="13" rx="3"/><path d="M9 18l-2 3v-3"/></svg>
const TrendingIcon  = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
const CheckIcon     = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const ChevronRight  = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
const ArrowRight    = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
const PlayIcon      = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4l13 8-13 8V4z"/></svg>
const XIcon         = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
const ClockIcon     = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
const PlusIcon      = () => <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
const KnowledgeIcon = () => <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h12a3 3 0 013 3v13a2 2 0 00-2-2H4z"/><path d="M4 4v15"/></svg>

/* ── helpers ─────────────────────────────────────────────────────────── */
function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const S = {
  serif: 'var(--font-instrument-serif)',
  mono:  'var(--font-geist-mono)',
  ink:   '#1A1915',
  ink2:  '#3F3D36',
  ink3:  '#6B6960',
  ink4:  '#9C9A90',
  border:'#E8E6DE',
  accent:'#1F7A4D',
  accentInk: '#0F4A30',
  accentSoft:'#F2F8F4',
  surface:'#FFFFFF',
  surface2:'#F6F5F1',
}

/* ── main ────────────────────────────────────────────────────────────── */
export default function DashboardClient({
  userName,
  hasBusiness,
  hasKnowledge,
  hasPersonality,
  hasActiveActionPages,
  hasFacebook,
  stats,
  recentSubmissions,
}: DashboardClientProps) {
  const isFullySetUp =
    hasBusiness && hasKnowledge && hasPersonality && hasActiveActionPages && hasFacebook

  const [dismissed, setDismissed] = useState(false)
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [playing, setPlaying] = useState<typeof VIDEOS[0] | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (localStorage.getItem('ws_onboarding_dismissed') === '1') {
      startTransition(() => setDismissed(true))
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        startTransition(() => setWatched(new Set(JSON.parse(raw) as string[])))
      } catch { /* ignore */ }
    }
  }, [startTransition])

  function dismiss() {
    localStorage.setItem('ws_onboarding_dismissed', '1')
    setDismissed(true)
  }

  function markWatched(id: string) {
    setWatched(prev => {
      const next = new Set(prev).add(id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  function openVideo(v: typeof VIDEOS[0]) {
    setPlaying(v)
    markWatched(v.id)
  }

  useEffect(() => {
    if (!playing) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlaying(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [playing])

  const showOnboarding = !isFullySetUp && !dismissed

  const onboardingSteps = [
    { id: 'business',  title: 'Tell us about your business',     desc: 'WhatStage uses this to personalize replies and pages.',         done: hasBusiness,          href: '/onboarding/business',         minutes: 2 },
    { id: 'knowledge', title: 'Add your knowledge',              desc: 'Upload FAQs, docs, or links so the chatbot can answer.',        done: hasKnowledge,         href: '/dashboard/knowledge',         minutes: 5 },
    { id: 'chatbot',   title: 'Train your AI chatbot',           desc: 'Give it a voice, test it, and set its personality.',           done: hasPersonality,       href: '/dashboard/chatbot',           minutes: 6 },
    { id: 'action',    title: 'Publish your first action page',  desc: 'Create a booking page or lead form and share the link.',       done: hasActiveActionPages, href: '/dashboard/action-pages',      minutes: 3 },
    { id: 'connect',   title: 'Connect a channel',               desc: 'Hook up Messenger so your AI can capture leads automatically.', done: hasFacebook,          href: '/dashboard/settings/facebook', minutes: 4 },
  ]

  const completed = onboardingSteps.filter(s => s.done).length
  const pct = Math.round((completed / onboardingSteps.length) * 100)
  const nextStep = onboardingSteps.find(s => !s.done)
  const watchedCount = watched.size
  const nextVideo = VIDEOS.find(v => !watched.has(v.id))

  /* ── shared sub-styles ── */
  const sectionHead = (label: string, sub: string, linkLabel?: string, linkHref?: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <h2 style={{ fontFamily: S.serif, fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.01em', color: S.ink }}>{label}</h2>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: S.ink4 }}>{sub}</p>
      </div>
      {linkLabel && linkHref && (
        <Link href={linkHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: S.ink3, textDecoration: 'none', fontWeight: 500, flexShrink: 0 }}>
          {linkLabel} <ArrowRight size={12} />
        </Link>
      )}
    </div>
  )

  return (
    <>
      <style>{CSS}</style>
      <div className="db-wrap">

        {/* ── HERO ── */}
        {showOnboarding && (
          <section className="db-hero" style={{ background: 'linear-gradient(135deg,#FBF9F4 0%,#F5F1E8 100%)', border: '1px solid #E5DFD0', borderRadius: 18, padding: '28px 32px' }}>
            <div style={{ position: 'absolute', top: -80, right: -80, width: 280, height: 280, background: 'radial-gradient(circle,rgba(31,122,77,0.08),transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, zIndex: 1 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: S.mono, fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', color: S.accentInk, background: 'rgba(31,122,77,0.10)', padding: '5px 10px', borderRadius: 999, width: 'fit-content' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: S.accent, boxShadow: '0 0 0 3px rgba(31,122,77,0.15)', flexShrink: 0 }} />
                Getting started · {completed} of {onboardingSteps.length} done
              </div>
              <h1 style={{ fontFamily: S.serif, fontSize: 'clamp(26px,4vw,36px)', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.15, margin: 0, color: S.ink }}>
                Let&apos;s get your workspace earning.
              </h1>
              <p style={{ margin: 0, fontSize: 14.5, color: S.ink3, lineHeight: 1.55, maxWidth: 460 }}>
                You&apos;re {pct}% set up. Finish a few quick steps and your AI will start booking calls and answering leads on its own.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <div style={{ height: 6, background: 'rgba(0,0,0,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#1F7A4D,#2EA86A)', borderRadius: 999, transition: 'width 320ms' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 12, color: S.ink3 }}>
                  <strong style={{ color: S.ink }}>{pct}%</strong> complete · ~{onboardingSteps.filter(s => !s.done).reduce((a, s) => a + s.minutes, 0)} min left
                </div>
              </div>
              {nextStep && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: `1px solid ${S.border}`, borderRadius: 12, padding: '12px 14px', marginTop: 6, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: S.ink4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>Next up</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: S.ink }}>{nextStep.title}</span>
                  </div>
                  <Link href={nextStep.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: S.accent, color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    Continue <ArrowRight size={13} />
                  </Link>
                </div>
              )}
            </div>

            {/* hero video — hidden on mobile via .db-hero-video */}
            <div className="db-hero-video" onClick={() => openVideo(VIDEOS[0])} style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', aspectRatio: '16/10', boxShadow: '0 12px 30px -12px rgba(0,0,0,0.25)', transition: 'transform 200ms', background: 'linear-gradient(135deg,#1F7A4D,#14120C)', zIndex: 1 }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}>
              {VIDEOS[0].thumb ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={VIDEOS[0].thumb} alt={VIDEOS[0].title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0.15),transparent 40%,rgba(0,0,0,0.55))' }} />
                </>
              ) : (
                <svg viewBox="0 0 240 140" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice">
                  <circle cx="60" cy="40" r="34" fill="rgba(255,255,255,0.08)" />
                  <circle cx="190" cy="100" r="48" fill="rgba(255,255,255,0.06)" />
                  <rect x="120" y="20" width="80" height="6" rx="3" fill="rgba(255,255,255,0.12)" />
                  <rect x="120" y="32" width="50" height="6" rx="3" fill="rgba(255,255,255,0.08)" />
                </svg>
              )}
              <div style={{ position: 'absolute', left: 24, bottom: 56, width: 52, height: 52, background: 'white', color: S.ink, borderRadius: 999, display: 'grid', placeItems: 'center', boxShadow: '0 8px 20px rgba(0,0,0,0.25)' }}>
                <PlayIcon size={20} />
              </div>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', background: 'linear-gradient(transparent,rgba(0,0,0,0.7))', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: S.mono, fontSize: 10.5, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Watch the intro · {VIDEOS[0].length}</span>
                <span style={{ color: 'white', fontSize: 18, fontFamily: S.serif, letterSpacing: '-0.01em' }}>{VIDEOS[0].title}</span>
              </div>
              {watched.has('v1') && (
                <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, backdropFilter: 'blur(4px)' }}>Watched</div>
              )}
            </div>

            <button onClick={dismiss} style={{ position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 999, background: 'rgba(0,0,0,0.04)', border: `1px solid ${S.border}`, display: 'grid', placeItems: 'center', color: S.ink3, cursor: 'pointer', zIndex: 3 }} title="Dismiss">
              <XIcon />
            </button>
          </section>
        )}

        {/* ── SETUP CHECKLIST ── */}
        {showOnboarding && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontFamily: S.serif, fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.01em', color: S.ink }}>Your setup checklist</h2>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: S.ink4 }}>Five steps to a fully working workspace.</p>
              </div>
              <button onClick={dismiss} style={{ padding: '7px 12px', background: 'transparent', border: 'none', color: S.ink3, fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: 8, flexShrink: 0 }}>Hide</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14, overflow: 'hidden' }}>
              {onboardingSteps.map((step, i) => {
                const isNext = !step.done && i === onboardingSteps.findIndex(s => !s.done)
                return (
                  <div key={step.id} className="db-checklist-row" style={{ borderBottom: i < onboardingSteps.length - 1 ? `1px solid ${S.border}` : 'none', background: isNext ? S.accentSoft : 'transparent' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 999, background: step.done ? S.accent : isNext ? 'white' : S.surface2, border: `1.5px solid ${step.done ? S.accent : isNext ? S.accent : S.border}`, display: 'grid', placeItems: 'center', color: step.done ? 'white' : isNext ? S.accent : S.ink4, fontSize: 12, fontWeight: 600, flexShrink: 0, boxShadow: isNext ? '0 0 0 3px rgba(31,122,77,0.15)' : 'none' }}>
                      {step.done ? <CheckIcon size={13} /> : <span>{i + 1}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: step.done ? S.ink4 : S.ink, textDecoration: step.done ? 'line-through' : 'none', textDecorationColor: 'rgba(0,0,0,0.2)' }}>{step.title}</div>
                      <div style={{ fontSize: 12.5, color: S.ink4 }}>{step.desc}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <span className="db-checklist-time" style={{ alignItems: 'center', gap: 4, fontSize: 11.5, color: S.ink4, fontFamily: S.mono }}>
                        <ClockIcon /> {step.minutes}m
                      </span>
                      {step.done ? (
                        <span style={{ fontSize: 11.5, color: S.accentInk, fontWeight: 500 }}>Done</span>
                      ) : (
                        <Link href={step.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'white', border: `1px solid #D9D6CC`, borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: S.ink, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          Start <ChevronRight size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── STATS ── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sectionHead('This week at a glance', 'The numbers that actually matter.', 'View activity', '/dashboard/action-pages')}
          <div className="db-stats">
            {[
              { label: 'Bookings', icon: <CalendarIcon size={14} />, val: stats.bookingsToday, sub: `${stats.bookingsWeek} this week`, href: '/dashboard/action-pages', accent: true },
              { label: 'New leads',    icon: <LeadsIcon />,    val: stats.leadsWeek,         sub: 'this week',       href: null, accent: false },
              { label: 'Submissions',  icon: <ChatbotIcon />,  val: stats.submissionsMonth,  sub: 'last 30 days',    href: null, accent: false },
            ].map(card => (
              <div key={card.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: card.accent ? 'linear-gradient(135deg,#F2F8F4,white)' : S.surface, border: `1px solid ${card.accent ? '#DCEAE0' : S.border}`, borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.ink3, fontWeight: 500 }}>
                  {card.icon} {card.label}
                </div>
                <div style={{ fontFamily: S.serif, fontSize: 'clamp(24px,3vw,32px)', fontWeight: 400, letterSpacing: '-0.01em', color: S.ink, lineHeight: 1.05 }}>
                  {card.val}
                </div>
                <div style={{ fontSize: 12, color: S.ink4 }}>{card.sub}</div>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.ink3, fontWeight: 500 }}>
                <TrendingIcon size={14} /> Action pages
              </div>
              <div style={{ fontFamily: S.serif, fontSize: 'clamp(14px,2vw,16px)', fontWeight: 600, color: hasActiveActionPages ? S.accentInk : S.ink4, lineHeight: 1.4, marginTop: 4 }}>
                {hasActiveActionPages ? '✓ Active' : 'None yet'}
              </div>
              <Link href="/dashboard/action-pages" style={{ fontSize: 12, color: S.accent, textDecoration: 'none', fontWeight: 500 }}>Manage pages →</Link>
            </div>
          </div>
        </section>

        {/* ── TWO COLUMNS ── */}
        <section className="db-two-col">
          {/* Quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sectionHead('Things you can do', 'One click to your most-used tools.')}
            <div className="db-qa-grid">
              {[
                { icon: <PlusIcon />,       label: 'New action page',  desc: 'Booking, form, or quote', accent: '#1F7A4D', href: '/dashboard/action-pages' },
                { icon: <ChatbotIcon />,    label: 'Test the chatbot', desc: 'Send a sample message',   accent: '#7C3AED', href: '/dashboard/chatbot'      },
                { icon: <KnowledgeIcon />,  label: 'Add a doc',        desc: 'PDF, link, or text',      accent: '#2563EB', href: '/dashboard/knowledge'    },
                { icon: <LeadsIcon />,      label: 'View your leads',  desc: 'See who reached out',     accent: '#C2410C', href: '/dashboard/leads'        },
              ].map(a => (
                <Link key={a.label} href={a.href} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 16px', alignItems: 'center', gap: 12, padding: 14, background: S.surface, border: `1px solid ${S.border}`, borderRadius: 12, textDecoration: 'none', color: 'inherit', transition: 'all 120ms' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-1px)'; el.style.borderColor = '#D9D6CC'; el.style.boxShadow = '0 8px 16px -10px rgba(0,0,0,0.08)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.borderColor = S.border; el.style.boxShadow = 'none' }}>
                  <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${a.accent}18`, color: a.accent }}>
                    {a.icon}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: S.ink }}>{a.label}</span>
                    <span style={{ fontSize: 12, color: S.ink4 }}>{a.desc}</span>
                  </span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sectionHead('Recent activity', 'Latest bookings and submissions.', 'All', '/dashboard/action-pages')}
            <div style={{ display: 'flex', flexDirection: 'column', background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14, overflow: 'hidden' }}>
              {recentSubmissions.length === 0 ? (
                <div style={{ padding: '28px 20px', textAlign: 'center', color: S.ink4, fontSize: 13 }}>
                  No submissions yet. Share your action page to start collecting leads.
                </div>
              ) : recentSubmissions.map((s, i) => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, alignItems: 'flex-start', padding: '12px 16px', borderBottom: i < recentSubmissions.length - 1 ? `1px solid ${S.border}` : 'none' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(31,122,77,0.10)', color: S.accentInk }}>
                    <CalendarIcon size={14} />
                  </span>
                  <div>
                    <div style={{ fontSize: 13.5, color: S.ink2 }}>
                      <strong style={{ color: S.ink }}>{s.name || 'Someone'}</strong> submitted to <strong style={{ color: S.ink }}>{s.actionPageTitle}</strong>
                    </div>
                    <div style={{ fontSize: 11.5, color: S.ink4, marginTop: 2 }}>{relTime(s.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── LEARN — video course ── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontFamily: S.serif, fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.01em', color: S.ink }}>Learn WhatStage</h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: S.ink4 }}>
                {watchedCount === 0 && `${VIDEOS.length} short videos to get you up to speed.`}
                {watchedCount > 0 && watchedCount < VIDEOS.length && `${watchedCount} of ${VIDEOS.length} watched — keep going!`}
                {watchedCount === VIDEOS.length && "You've finished the course. You're a WhatStage pro."}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {VIDEOS.map(v => (
                  <div key={v.id} style={{ width: 20, height: 4, borderRadius: 999, background: watched.has(v.id) ? S.accent : S.border, transition: 'background 200ms' }} />
                ))}
              </div>
              <span style={{ fontFamily: S.mono, fontSize: 11, color: S.ink4 }}>{watchedCount}/{VIDEOS.length}</span>
            </div>
          </div>

          {/* "continue" nudge */}
          {nextVideo && watchedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: S.accentSoft, border: '1px solid #DCEAE0', borderRadius: 10, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{ fontFamily: S.mono, fontSize: 11, color: S.accentInk, fontWeight: 600, flexShrink: 0 }}>UP NEXT</span>
                <span className="db-vid-next-title" style={{ fontSize: 13, color: S.ink, fontWeight: 500 }}>{nextVideo.num}. {nextVideo.title}</span>
                <span className="db-vid-next-len" style={{ fontSize: 12, color: S.ink4 }}>· {nextVideo.length}</span>
              </div>
              <button onClick={() => openVideo(nextVideo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: S.accent, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>
                <PlayIcon size={12} /> Watch
              </button>
            </div>
          )}

          <div className="db-vid-grid">
            {VIDEOS.map(v => {
              const isWatched = watched.has(v.id)
              const isNext = v.id === nextVideo?.id
              return (
                <button key={v.id} onClick={() => openVideo(v)} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.surface, border: `1px solid ${isNext ? '#DCEAE0' : S.border}`, borderRadius: 14, padding: 10, textAlign: 'left', cursor: 'pointer', transition: 'all 150ms', position: 'relative' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 12px 24px -16px rgba(0,0,0,0.15)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = 'none' }}>
                  {isNext && <div style={{ position: 'absolute', top: -1, left: -1, right: -1, height: 3, background: S.accent, borderRadius: '14px 14px 0 0' }} />}
                  <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', background: `linear-gradient(135deg,${v.color},#14120C)` }}>
                    {v.thumb ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={v.thumb} alt={v.title} loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: isWatched ? 'grayscale(0.4) brightness(0.85)' : 'none' }} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0.25),transparent 40%,rgba(0,0,0,0.35))' }} />
                      </>
                    ) : (
                      <svg viewBox="0 0 200 110" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice">
                        <circle cx="40" cy="30" r="22" fill="rgba(255,255,255,0.08)" />
                        <circle cx="160" cy="80" r="32" fill="rgba(255,255,255,0.06)" />
                      </svg>
                    )}
                    <div style={{ position: 'absolute', top: 8, left: 10, fontFamily: S.mono, fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: 600, letterSpacing: '0.04em', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{v.num}</div>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.95)', display: 'grid', placeItems: 'center', color: isWatched ? S.accent : S.ink, boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
                      {isWatched ? <CheckIcon size={18} /> : <PlayIcon size={14} />}
                    </div>
                    <span style={{ position: 'absolute', right: 8, bottom: 8, fontFamily: S.mono, fontSize: 10.5, background: 'rgba(0,0,0,0.65)', color: 'white', padding: '2px 6px', borderRadius: 4 }}>{v.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px 8px' }}>
                    <span style={{ fontFamily: S.mono, fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: isWatched ? S.ink4 : v.color }}>{v.tag}</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: isWatched ? S.ink3 : S.ink }}>{v.title}</div>
                    <div style={{ fontSize: 12, color: S.ink4, lineHeight: 1.4 }}>{v.desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── VIDEO PLAYER MODAL ── */}
        {playing && (
          <div ref={overlayRef} onClick={() => setPlaying(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,12,0.55)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16, animation: 'dashFadeIn 160ms ease-out both' }}>
            <style>{`
              @keyframes dashFadeIn{from{opacity:0}to{opacity:1}}
              @keyframes dashVidPop{from{transform:translateY(8px) scale(0.98);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
              .db-modal-nav{display:flex}
              @media(max-width:480px){.db-modal-nav{display:none}}
            `}</style>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, background: 'white', borderRadius: 16, overflow: 'hidden', position: 'relative', animation: 'dashVidPop 220ms cubic-bezier(0.2,0,0,1) both' }}>
              <button onClick={() => setPlaying(null)} style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.9)', display: 'grid', placeItems: 'center', border: 'none', cursor: 'pointer', zIndex: 2, color: S.ink }}>
                <XIcon />
              </button>
              <div style={{ position: 'relative', aspectRatio: '16/9', width: '100%', display: 'grid', placeItems: 'center', background: `linear-gradient(135deg,${playing.color},#14120C)` }}>
                {playing.loomId ? (
                  <iframe
                    key={playing.loomId}
                    src={`https://www.loom.com/embed/${playing.loomId}?hideEmbedTopBar=true`}
                    title={playing.title}
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <>
                    <svg viewBox="0 0 720 405" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice">
                      <circle cx="120" cy="100" r="80" fill="rgba(255,255,255,0.06)" />
                      <circle cx="600" cy="300" r="120" fill="rgba(255,255,255,0.04)" />
                    </svg>
                    <div style={{ width: 70, height: 70, borderRadius: 999, background: 'white', color: S.ink, display: 'grid', placeItems: 'center', boxShadow: '0 12px 30px rgba(0,0,0,0.3)', position: 'relative' }}>
                      <PlayIcon size={28} />
                    </div>
                    <div style={{ position: 'absolute', top: 16, left: 18, fontFamily: S.mono, fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em' }}>
                      Lesson {playing.num} of {VIDEOS.length}
                    </div>
                  </>
                )}
              </div>
              <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: S.mono, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: playing.color }}>{playing.tag}</span>
                <h3 style={{ fontFamily: S.serif, fontSize: 'clamp(18px,4vw,24px)', fontWeight: 400, margin: '4px 0 0', color: S.ink }}>{playing.title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, color: S.ink3 }}>{playing.desc}</p>
                {/* dots always visible */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  {VIDEOS.map(v => (
                    <button key={v.id} onClick={() => openVideo(v)} style={{ width: 8, height: 8, borderRadius: 999, border: 'none', cursor: 'pointer', background: v.id === playing.id ? S.ink : watched.has(v.id) ? S.accent : S.border, transition: 'all 150ms', transform: v.id === playing.id ? 'scale(1.5)' : 'scale(1)', padding: 0 }} />
                  ))}
                </div>
                {/* prev/next — hidden on small phones */}
                <div className="db-modal-nav" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 14, borderTop: `1px solid ${S.border}`, gap: 8 }}>
                  {(() => {
                    const idx = VIDEOS.findIndex(v => v.id === playing.id)
                    const prev = VIDEOS[idx - 1]
                    return prev ? (
                      <button onClick={() => openVideo(prev)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'white', border: `1px solid #D9D6CC`, borderRadius: 8, fontSize: 13, fontWeight: 500, color: S.ink, cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }}>
                        ← {prev.num}. {prev.title}
                      </button>
                    ) : <div />
                  })()}
                  {(() => {
                    const idx = VIDEOS.findIndex(v => v.id === playing.id)
                    const next = VIDEOS[idx + 1]
                    return next ? (
                      <button onClick={() => openVideo(next)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: S.accent, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }}>
                        {next.num}. {next.title} →
                      </button>
                    ) : (
                      <button onClick={() => setPlaying(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: S.accent, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                        Done <CheckIcon size={13} />
                      </button>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
