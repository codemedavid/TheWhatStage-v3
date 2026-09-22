// Fail fast on a misconfigured build rather than at the first network call.

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`[env] ${name} is not set. Copy mobile/.env.example to mobile/.env.`)
  }
  return value.trim()
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  apiUrl: required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, ''),
} as const
