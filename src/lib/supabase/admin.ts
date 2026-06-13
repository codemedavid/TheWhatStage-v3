import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Server-only admin client. Bypasses RLS — never import from client code.
// `import 'server-only'` makes a client-bundle import a hard build error, so the
// service-role key can never leak into the browser (vitest aliases it to a stub).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
