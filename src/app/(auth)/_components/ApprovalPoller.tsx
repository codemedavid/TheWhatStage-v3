'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function ApprovalPoller() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(id)
  }, [router])

  return null
}
