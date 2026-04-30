import { buildDeeplinkParams, type DeeplinkClaims } from './signing'

function appBase(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is required')
  return base.replace(/\/+$/, '')
}

export function publicActionPageUrl(slug: string): string {
  return `${appBase()}/a/${slug}`
}

export function embedActionPageUrl(slug: string): string {
  return `${appBase()}/a/${slug}/embed`
}

/**
 * Standalone URL with a verified PSID/page deeplink — use when sending an
 * action-page button to a Messenger lead so the submission is attributed.
 */
export function deeplinkActionPageUrl(
  secret: string,
  claims: DeeplinkClaims,
  variant: 'standalone' | 'embed' = 'standalone',
): string {
  const base =
    variant === 'embed'
      ? embedActionPageUrl(claims.slug)
      : publicActionPageUrl(claims.slug)
  return `${base}?${buildDeeplinkParams(secret, claims).toString()}`
}
