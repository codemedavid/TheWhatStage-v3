import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'

/** Request-scoped getUser. Many lib helpers each call auth.getUser internally;
 * wrapping in React cache() collapses them into one round-trip per render. */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
})

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore when a proxy
            // is refreshing user sessions.
          }
        },
      },
    }
  )
}
