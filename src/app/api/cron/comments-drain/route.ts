import { after, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.COMMENT_WORKER_SECRET
  if (!base || !secret) {
    return NextResponse.json(
      { fired: false, reason: 'NEXT_PUBLIC_APP_URL or COMMENT_WORKER_SECRET missing' },
      { status: 200 },
    )
  }

  after(async () => {
    try {
      await fetch(`${base}/api/comments/process`, {
        method: 'POST',
        headers: { 'x-worker-secret': secret },
      })
    } catch (e) {
      console.warn('[cron.comments-drain] worker trigger failed', e)
    }
  })

  return NextResponse.json({ fired: true })
}
